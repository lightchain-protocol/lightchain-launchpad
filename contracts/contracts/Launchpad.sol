// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import {Token} from "./Token.sol";
import {CurveMath} from "./lib/CurveMath.sol";

/// @title Launchpad
/// @notice Monolithic launchpad: deploys a fresh ERC20 per launch, custodies the
///         for-sale supply + the raised native for every token, and trades each
///         token along its own constant-product virtual-reserve bonding curve. On
///         hitting the funding goal (or selling out the for-sale supply) it seeds a
///         Uniswap-V2 pair with `lpSupply` tokens + the raised native (minus the
///         graduation fee), burns the LP tokens, burns any unsold supply, and stops
///         curve trading for that token. All per-token state lives in `curves[token]`;
///         token-agnostic globals (fees, curve params, anti-bot, DEX router) are the
///         contract's top-level storage and are snapshotted into each curve at launch
///         so changing a global never retroactively affects an in-flight curve.
///
///         UUPS-upgradeable. The owner — which production must put behind a timelock
///         and/or multisig — controls config setters, pause, withdrawals, the upgrade,
///         and the per-token graduation escape hatch.
contract Launchpad is
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    uint16 private constant BPS = 10_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ----- bounds -----
    uint16 public constant MAX_TRADE_FEE_BPS = 1_000; // 10%
    uint16 public constant MAX_GRADUATION_FEE_BPS = 2_000; // 20%
    uint16 public constant MIN_LP_BPS = 100; // 1%
    uint16 public constant MAX_LP_BPS = 5_000; // 50%
    uint256 public constant MIN_FUNDING_GOAL = 1e15; // 0.001 native

    // ================================================================
    //  Storage — global config (snapshotted into Curve at createToken)
    // ================================================================
    // ----- fee config -----
    uint256 public creationFee;
    uint16 public tradeFeeBps;
    uint16 public graduationFeeBps;
    uint16 public creatorFeeShareBps; // creator share of each trade fee
    uint16 public gradCreatorShareBps; // creator share of the graduation fee
    address public treasury;

    // ----- curve config -----
    uint256 public tokenTotalSupply; // e.g. 1e9 * 1e18
    uint16 public lpBps; // reserved for the LP, e.g. 2000 (20%)
    uint256 public fundingGoal; // native target that triggers graduation
    uint256 public virtualEthReserve; // derived in setCurveParams
    uint256 public virtualTokenReserve; // chosen in setCurveParams

    // ----- anti-bot config -----
    uint256 public maxBuyPerTx; // 0 = disabled
    uint16 public maxWalletBps; // 0 = disabled
    uint32 public tradeCooldown; // 0 = disabled

    // ----- DEX -----
    address public dexRouter;

    // ----- launch registry -----
    address[] public allTokens;
    mapping(address token => address creator) public creatorOf;
    uint256 public accruedCreationFees; // pull-withdrawn by the owner to the treasury

    // ----- protocol-wide accounting -----
    /// @notice Protocol's share of every trade fee + graduation fee + any router-refund
    ///         dust, pooled across all tokens. Pull-withdrawn by the owner.
    uint256 public protocolFees;

    // ================================================================
    //  Storage — per-token Curve state
    // ================================================================
    /// @notice Per-launch snapshot + runtime state. Packed into 7 storage slots:
    ///         slots 0..3 are the config snapshot (frozen at `createToken`), slots 4..6
    ///         are the trading runtime. `uint128` is safe for every amount field —
    ///         2^128 ≈ 3.4·10^38 wei, far above any plausible reserve.
    struct Curve {
        // -- snapshot (slot 0)
        uint128 fundingGoal;
        uint128 maxSupplyForSale;
        // -- snapshot (slot 1)
        uint128 lpSupply;
        uint128 virtualEthReserve;
        // -- snapshot (slot 2)
        uint128 virtualTokenReserve;
        uint128 maxBuyPerTx;
        // -- snapshot (slot 3, packed shorts)
        uint16 tradeFeeBps;
        uint16 creatorFeeShareBps;
        uint16 graduationFeeBps;
        uint16 gradCreatorShareBps;
        uint16 maxWalletBps;
        uint32 tradeCooldown;
        // -- runtime (slot 4)
        uint128 realEthRaised;
        uint128 tokensSold;
        // -- runtime (slot 5)
        uint128 creatorFees;
        // -- runtime (slot 6, pair + graduated pack)
        address pair;
        bool graduated;
    }

    mapping(address token => Curve) internal _curves;
    mapping(address token => mapping(address user => uint256)) public lastTradeAt;

    uint256[20] private __gap;

    // ================================================================
    //  Events
    // ================================================================
    event TokenLaunched(
        address indexed token, address indexed creator, string name, string symbol, string metadataURI, uint256 devBuyEth
    );

    /// @param ethAmount net native moved on the curve side (buy: into the reserve;
    ///        sell: out of the reserve, before the fee). `feeAmount` is on top of it.
    /// @param priceX18 marginal native-per-token price (* 1e18) after the trade.
    event Trade(
        address indexed token,
        address indexed user,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 feeAmount,
        uint256 priceX18,
        uint256 realEthRaised,
        uint256 tokensSold
    );

    event Graduated(
        address indexed token,
        address indexed pair,
        uint256 ethToLp,
        uint256 tokensToLp,
        uint256 tokensBurned,
        bool degradedPath
    );

    event FeeConfigUpdated(
        uint256 creationFee,
        uint16 tradeFeeBps,
        uint16 graduationFeeBps,
        uint16 creatorFeeShareBps,
        uint16 gradCreatorShareBps,
        address treasury
    );
    event CurveParamsUpdated(
        uint256 totalSupply,
        uint16 lpBps,
        uint256 fundingGoal,
        uint256 virtualEthReserve,
        uint256 virtualTokenReserve
    );
    event AntiBotUpdated(uint256 maxBuyPerTx, uint16 maxWalletBps, uint32 tradeCooldown);
    event DexRouterUpdated(address router);

    event CreatorFeesClaimed(address indexed token, address indexed to, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event CreationFeesWithdrawn(address indexed to, uint256 amount);

    // ================================================================
    //  Errors
    // ================================================================
    error InvalidParam();
    error InsufficientCreationFee();
    error CurveInconsistent();
    error NothingToWithdraw();

    error Unauthorized();
    error AlreadyGraduated();
    error UnknownToken();
    error ZeroAmount();
    error SlippageExceeded();
    error MaxBuyExceeded();
    error MaxWalletExceeded();
    error CooldownActive();
    error CurveSoldOut();
    error ExceedsForSaleSupply();
    error NothingToClaim();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    struct InitArgs {
        address owner;
        address treasury;
        address dexRouter;
        // fees
        uint256 creationFee;
        uint16 tradeFeeBps;
        uint16 graduationFeeBps;
        uint16 creatorFeeShareBps;
        uint16 gradCreatorShareBps;
        // curve
        uint256 totalSupply;
        uint16 lpBps;
        uint256 fundingGoal;
        uint256 virtualTokenReserve;
        // anti-bot
        uint256 maxBuyPerTx;
        uint16 maxWalletBps;
        uint32 tradeCooldown;
    }

    function initialize(InitArgs calldata a) external initializer {
        __Ownable_init(a.owner);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _setFeeConfig(
            a.creationFee, a.tradeFeeBps, a.graduationFeeBps, a.creatorFeeShareBps, a.gradCreatorShareBps, a.treasury
        );
        _setCurveParams(a.totalSupply, a.lpBps, a.fundingGoal, a.virtualTokenReserve);
        _setAntiBot(a.maxBuyPerTx, a.maxWalletBps, a.tradeCooldown);
        _setDexRouter(a.dexRouter);
    }

    // ================================================================
    //  Launch
    // ================================================================
    /// @notice Deploys a new ERC20, snapshots the current global config into a fresh
    ///         per-token `Curve`, and (if `msg.value > creationFee`) immediately
    ///         executes the creator's launch dev-buy with the surplus.
    function createToken(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (address tokenAddr)
    {
        if (msg.value < creationFee) revert InsufficientCreationFee();
        uint256 devBuyEth = msg.value - creationFee;

        // mint the full supply directly to this launchpad
        tokenAddr = address(new Token(name, symbol, tokenTotalSupply, address(this)));

        // snapshot current global config into the new curve
        Curve storage c = _curves[tokenAddr];
        uint256 _maxSupplyForSale = maxSupplyForSale();
        c.fundingGoal = uint128(fundingGoal);
        c.maxSupplyForSale = uint128(_maxSupplyForSale);
        c.lpSupply = uint128(tokenTotalSupply - _maxSupplyForSale);
        c.virtualEthReserve = uint128(virtualEthReserve);
        c.virtualTokenReserve = uint128(virtualTokenReserve);
        c.maxBuyPerTx = uint128(maxBuyPerTx);
        c.tradeFeeBps = tradeFeeBps;
        c.creatorFeeShareBps = creatorFeeShareBps;
        c.graduationFeeBps = graduationFeeBps;
        c.gradCreatorShareBps = gradCreatorShareBps;
        c.maxWalletBps = maxWalletBps;
        c.tradeCooldown = tradeCooldown;

        creatorOf[tokenAddr] = msg.sender;
        allTokens.push(tokenAddr);
        accruedCreationFees += creationFee;

        emit TokenLaunched(tokenAddr, msg.sender, name, symbol, metadataURI, devBuyEth);

        if (devBuyEth > 0) {
            _buy(tokenAddr, msg.sender, msg.sender, devBuyEth, 0);
        }
    }

    // ================================================================
    //  Trading
    // ================================================================
    function buy(address token, uint256 minTokensOut)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return _buy(token, msg.sender, msg.sender, msg.value, minTokensOut);
    }

    function sell(address token, uint256 tokenAmount, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 ethOutNet)
    {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();

        (uint256 _ethOutNet, uint256 fee) = quoteSell(token, tokenAmount);
        if (_ethOutNet < minEthOut) revert SlippageExceeded();
        if (c.tradeCooldown != 0 && block.timestamp < lastTradeAt[token][msg.sender] + c.tradeCooldown) {
            revert CooldownActive();
        }

        uint256 gross = _ethOutNet + fee;
        uint256 creatorCut = CurveMath.share(fee, c.creatorFeeShareBps);
        uint256 protocolCut = fee - creatorCut;

        // effects (CEI). Checked subtraction: with the curve's rounding discipline these
        // can never underflow; if they ever would, the sell reverts rather than corrupting.
        c.realEthRaised = uint128(uint256(c.realEthRaised) - gross);
        c.tokensSold = uint128(uint256(c.tokensSold) - tokenAmount);
        lastTradeAt[token][msg.sender] = block.timestamp;
        c.creatorFees = uint128(uint256(c.creatorFees) + creatorCut);
        protocolFees += protocolCut;
        ethOutNet = _ethOutNet;

        // interactions
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        Address.sendValue(payable(msg.sender), _ethOutNet);

        emit Trade(
            token,
            msg.sender,
            false,
            gross,
            tokenAmount,
            fee,
            _currentPriceX18(c),
            c.realEthRaised,
            c.tokensSold
        );
    }

    /// @dev Unified buy path used by both `buy` and the in-tx dev-buy in `createToken`.
    ///      Note: `createToken` already holds `whenNotPaused`/`nonReentrant`; we don't
    ///      re-check pause here because the dev-buy is part of the launch transaction
    ///      and skipping the redundant check keeps gas tight. The external `buy` entry
    ///      point applies both modifiers.
    function _buy(address token, address payer, address to, uint256 ethIn, uint256 minTokensOut)
        internal
        returns (uint256 tokensOut)
    {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();

        uint256 ethInNet;
        uint256 fee;
        uint256 refund;
        (tokensOut, ethInNet, fee, refund) = _quoteBuy(c, ethIn);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        bool willGraduate =
            (uint256(c.tokensSold) + tokensOut >= c.maxSupplyForSale) || (uint256(c.realEthRaised) + ethInNet >= c.fundingGoal);

        // anti-bot
        if (c.maxBuyPerTx != 0 && ethInNet > c.maxBuyPerTx) revert MaxBuyExceeded();
        if (c.maxWalletBps != 0 && !willGraduate) {
            uint256 cap = CurveMath.share(c.maxSupplyForSale, c.maxWalletBps);
            if (IERC20(token).balanceOf(to) + tokensOut > cap) revert MaxWalletExceeded();
        }
        if (c.tradeCooldown != 0 && block.timestamp < lastTradeAt[token][payer] + c.tradeCooldown) {
            revert CooldownActive();
        }

        // effects
        uint256 creatorCut = CurveMath.share(fee, c.creatorFeeShareBps);
        uint256 protocolCut = fee - creatorCut;
        c.realEthRaised = uint128(uint256(c.realEthRaised) + ethInNet);
        c.tokensSold = uint128(uint256(c.tokensSold) + tokensOut);
        lastTradeAt[token][payer] = block.timestamp;
        c.creatorFees = uint128(uint256(c.creatorFees) + creatorCut);
        protocolFees += protocolCut;

        // interactions
        IERC20(token).safeTransfer(to, tokensOut);
        if (refund > 0) Address.sendValue(payable(to), refund);

        emit Trade(token, to, true, ethInNet, tokensOut, fee, _currentPriceX18(c), c.realEthRaised, c.tokensSold);

        if (willGraduate) _graduate(token);
    }

    // ================================================================
    //  Graduation
    // ================================================================
    /// @notice Owner escape hatch: graduate a token's curve even if the threshold
    ///         isn't reached (e.g. to rescue a curve wedged by a misconfigured DEX).
    function graduateByOwner(address token) external onlyOwner nonReentrant {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
        _graduate(token);
    }

    function _graduate(address token) internal {
        Curve storage c = _curves[token];
        c.graduated = true;

        uint256 raised = c.realEthRaised;
        uint256 gradFee = CurveMath.feeOf(raised, c.graduationFeeBps);
        uint256 gradCreatorCut = CurveMath.share(gradFee, c.gradCreatorShareBps);
        c.creatorFees = uint128(uint256(c.creatorFees) + gradCreatorCut);
        protocolFees += gradFee - gradCreatorCut;
        uint256 ethForLp = raised - gradFee;

        IUniswapV2Router02 router = IUniswapV2Router02(dexRouter);
        address weth = router.WETH();
        IUniswapV2Factory dexFactory = IUniswapV2Factory(router.factory());

        address _pair = dexFactory.getPair(token, weth);
        if (_pair == address(0)) _pair = dexFactory.createPair(token, weth);
        c.pair = _pair;

        bool degraded;
        {
            (uint112 r0, uint112 r1,) = IUniswapV2Pair(_pair).getReserves();
            degraded = (r0 != 0 || r1 != 0); // someone pre-seeded the pool
        }

        uint256 _lpSupply = c.lpSupply;
        IERC20(token).forceApprove(address(router), _lpSupply);
        (uint256 usedToken, uint256 usedEth,) =
            router.addLiquidityETH{value: ethForLp}(token, _lpSupply, 0, 0, address(this), block.timestamp);
        IERC20(token).forceApprove(address(router), 0);

        // burn the LP we received
        uint256 lpBal = IERC20(_pair).balanceOf(address(this));
        if (lpBal > 0) IERC20(_pair).safeTransfer(DEAD, lpBal);

        // any native the router didn't use (only on a pre-seeded pool) becomes protocol slack
        uint256 ethDust = ethForLp - usedEth;
        if (ethDust > 0) protocolFees += ethDust;

        // burn whatever we still hold of this token: unsold for-sale supply + any token dust
        uint256 leftover = IERC20(token).balanceOf(address(this));
        if (leftover > 0) Token(token).burn(leftover);

        emit Graduated(token, _pair, usedEth, usedToken, leftover, degraded);
    }

    // ================================================================
    //  Fees: pull-withdrawals
    // ================================================================
    function claimCreatorFees(address token, address to) external nonReentrant {
        if (msg.sender != creatorOf[token]) revert Unauthorized();
        if (to == address(0)) revert ZeroAmount();
        Curve storage c = _curves[token];
        uint256 amount = c.creatorFees;
        if (amount == 0) revert NothingToClaim();
        c.creatorFees = 0;
        Address.sendValue(payable(to), amount);
        emit CreatorFeesClaimed(token, to, amount);
    }

    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidParam();
        uint256 amount = protocolFees;
        if (amount == 0) revert NothingToWithdraw();
        protocolFees = 0;
        Address.sendValue(payable(to), amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    function withdrawCreationFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidParam();
        uint256 amount = accruedCreationFees;
        if (amount == 0) revert NothingToWithdraw();
        accruedCreationFees = 0;
        Address.sendValue(payable(to), amount);
        emit CreationFeesWithdrawn(to, amount);
    }

    // ================================================================
    //  Owner config
    // ================================================================
    function setFeeConfig(
        uint256 creationFee_,
        uint16 tradeFeeBps_,
        uint16 graduationFeeBps_,
        uint16 creatorFeeShareBps_,
        uint16 gradCreatorShareBps_,
        address treasury_
    ) external onlyOwner {
        _setFeeConfig(creationFee_, tradeFeeBps_, graduationFeeBps_, creatorFeeShareBps_, gradCreatorShareBps_, treasury_);
    }

    function setCurveParams(uint256 totalSupply_, uint16 lpBps_, uint256 fundingGoal_, uint256 virtualTokenReserve_)
        external
        onlyOwner
    {
        _setCurveParams(totalSupply_, lpBps_, fundingGoal_, virtualTokenReserve_);
    }

    function setAntiBot(uint256 maxBuyPerTx_, uint16 maxWalletBps_, uint32 tradeCooldown_) external onlyOwner {
        _setAntiBot(maxBuyPerTx_, maxWalletBps_, tradeCooldown_);
    }

    function setDexRouter(address router_) external onlyOwner {
        _setDexRouter(router_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ================================================================
    //  Views — globals
    // ================================================================
    function maxSupplyForSale() public view returns (uint256) {
        return tokenTotalSupply - CurveMath.share(tokenTotalSupply, lpBps);
    }

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokens(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory tokens, uint256 total)
    {
        total = allTokens.length;
        if (offset >= total) return (new address[](0), total);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        tokens = new address[](n);
        for (uint256 i; i < n; ++i) {
            tokens[i] = allTokens[offset + i];
        }
    }

    // ================================================================
    //  Views — per-token (each takes a `token` argument)
    // ================================================================
    /// @notice The full per-token Curve struct: snapshot config + runtime state.
    function curves(address token) external view returns (Curve memory) {
        return _curves[token];
    }

    function realEthRaisedOf(address token) external view returns (uint256) {
        return _curves[token].realEthRaised;
    }

    function tokensSoldOf(address token) external view returns (uint256) {
        return _curves[token].tokensSold;
    }

    function creatorFeesOf(address token) external view returns (uint256) {
        return _curves[token].creatorFees;
    }

    function isGraduated(address token) external view returns (bool) {
        return _curves[token].graduated;
    }

    function pairOf(address token) external view returns (address) {
        return _curves[token].pair;
    }

    function fundingGoalOf(address token) external view returns (uint256) {
        return _curves[token].fundingGoal;
    }

    function maxSupplyForSaleOf(address token) external view returns (uint256) {
        return _curves[token].maxSupplyForSale;
    }

    function lpSupplyOf(address token) external view returns (uint256) {
        return _curves[token].lpSupply;
    }

    function ethReserveOf(address token) public view returns (uint256) {
        Curve storage c = _curves[token];
        return uint256(c.virtualEthReserve) + uint256(c.realEthRaised);
    }

    function tokenReserveOf(address token) public view returns (uint256) {
        Curve storage c = _curves[token];
        return uint256(c.virtualTokenReserve) - uint256(c.tokensSold);
    }

    /// @notice Marginal price (native wei per 1e18 token-wei), scaled by 1e18.
    function currentPriceX18(address token) external view returns (uint256) {
        return _currentPriceX18(_curves[token]);
    }

    /// @notice Notional market cap in native wei (price * token totalSupply).
    function marketCap(address token) external view returns (uint256) {
        Curve storage c = _curves[token];
        uint256 ts = IERC20(token).totalSupply();
        return Math.mulDiv(
            uint256(c.virtualEthReserve) + uint256(c.realEthRaised),
            ts,
            uint256(c.virtualTokenReserve) - uint256(c.tokensSold)
        );
    }

    function reservesOf(address token) external view returns (uint256 ethReserveEff, uint256 tokenReserveEff) {
        return (ethReserveOf(token), tokenReserveOf(token));
    }

    function stateOf(address token)
        external
        view
        returns (uint256 raised, uint256 sold, bool graduated_, address dexPair)
    {
        Curve storage c = _curves[token];
        return (c.realEthRaised, c.tokensSold, c.graduated, c.pair);
    }

    /// @notice Quote a buy of `ethIn` gross native. `ethIn == ethInNet + fee + refund`.
    function quoteBuy(address token, uint256 ethIn)
        external
        view
        returns (uint256 tokensOut, uint256 ethInNet, uint256 fee, uint256 refund)
    {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        return _quoteBuy(c, ethIn);
    }

    /// @notice Quote the gross native required to buy at least `tokensOut` (no clamp/refund).
    /// @dev Inverse of `quoteBuy` for fills within the remaining for-sale supply.
    ///      `ethIn == ethInNet + fee` with `fee = feeOf(ethIn)` — the same split `buy`
    ///      applies. Buying with `ethIn` yields at least `tokensOut` (curve-favouring
    ///      rounding can deliver a few wei of extra tokens).
    function quoteBuyForTokens(address token, uint256 tokensOut)
        external
        view
        returns (uint256 ethIn, uint256 ethInNet, uint256 fee)
    {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        return _quoteBuyForTokens(c, tokensOut);
    }

    /// @notice Quote a sell of `tokenAmount` tokens. Returns the net native received and the fee.
    function quoteSell(address token, uint256 tokenAmount) public view returns (uint256 ethOutNet, uint256 fee) {
        Curve storage c = _curves[token];
        if (c.fundingGoal == 0) revert UnknownToken();
        if (tokenAmount == 0) revert ZeroAmount();
        uint256 ethReserveEff = uint256(c.virtualEthReserve) + uint256(c.realEthRaised);
        uint256 tokenReserveEff = uint256(c.virtualTokenReserve) - uint256(c.tokensSold);
        uint256 gross = CurveMath.getAmountOut(tokenAmount, tokenReserveEff, ethReserveEff);
        fee = CurveMath.feeOf(gross, c.tradeFeeBps);
        ethOutNet = gross - fee;
    }

    // ================================================================
    //  Internal helpers
    // ================================================================
    function _currentPriceX18(Curve storage c) internal view returns (uint256) {
        return Math.mulDiv(
            uint256(c.virtualEthReserve) + uint256(c.realEthRaised),
            1e18,
            uint256(c.virtualTokenReserve) - uint256(c.tokensSold)
        );
    }

    function _quoteBuy(Curve storage c, uint256 ethIn)
        internal
        view
        returns (uint256 tokensOut, uint256 ethInNet, uint256 fee, uint256 refund)
    {
        if (ethIn == 0) revert ZeroAmount();
        uint256 remaining = uint256(c.maxSupplyForSale) - uint256(c.tokensSold);
        if (remaining == 0) revert CurveSoldOut();

        uint256 ethReserveEff = uint256(c.virtualEthReserve) + uint256(c.realEthRaised);
        uint256 tokenReserveEff = uint256(c.virtualTokenReserve) - uint256(c.tokensSold);

        fee = CurveMath.feeOf(ethIn, c.tradeFeeBps);
        ethInNet = ethIn - fee;
        uint256 out = CurveMath.getAmountOut(ethInNet, ethReserveEff, tokenReserveEff);

        if (out <= remaining) {
            tokensOut = out;
            refund = 0;
        } else {
            // clamp to the remaining for-sale supply and refund the surplus
            tokensOut = remaining;
            uint256 netExact = CurveMath.getAmountIn(remaining, ethReserveEff, tokenReserveEff);
            uint256 grossUsed = CurveMath.grossForNet(netExact, c.tradeFeeBps);
            if (grossUsed > ethIn) grossUsed = ethIn; // 1-wei rounding edge
            ethInNet = netExact;
            fee = grossUsed - netExact;
            refund = ethIn - grossUsed;
        }
    }

    function _quoteBuyForTokens(Curve storage c, uint256 tokensOut)
        internal
        view
        returns (uint256 ethIn, uint256 ethInNet, uint256 fee)
    {
        if (tokensOut == 0) revert ZeroAmount();
        uint256 remaining = uint256(c.maxSupplyForSale) - uint256(c.tokensSold);
        if (remaining == 0) revert CurveSoldOut();
        if (tokensOut > remaining) revert ExceedsForSaleSupply();

        uint256 ethReserveEff = uint256(c.virtualEthReserve) + uint256(c.realEthRaised);
        uint256 tokenReserveEff = uint256(c.virtualTokenReserve) - uint256(c.tokensSold);

        // Minimum net that produces >= tokensOut, then lift to a gross whose
        // post-feeOf remainder covers that net — same fee path as `_quoteBuy`/`buy`.
        uint256 ethInNetRequired = CurveMath.getAmountIn(tokensOut, ethReserveEff, tokenReserveEff);
        ethIn = CurveMath.grossForNet(ethInNetRequired, c.tradeFeeBps);
        fee = CurveMath.feeOf(ethIn, c.tradeFeeBps);
        ethInNet = ethIn - fee;
    }

    // ================================================================
    //  Internal config setters
    // ================================================================
    function _setFeeConfig(
        uint256 creationFee_,
        uint16 tradeFeeBps_,
        uint16 graduationFeeBps_,
        uint16 creatorFeeShareBps_,
        uint16 gradCreatorShareBps_,
        address treasury_
    ) internal {
        if (treasury_ == address(0)) revert InvalidParam();
        if (tradeFeeBps_ > MAX_TRADE_FEE_BPS) revert InvalidParam();
        if (graduationFeeBps_ > MAX_GRADUATION_FEE_BPS) revert InvalidParam();
        if (creatorFeeShareBps_ > BPS || gradCreatorShareBps_ > BPS) revert InvalidParam();
        creationFee = creationFee_;
        tradeFeeBps = tradeFeeBps_;
        graduationFeeBps = graduationFeeBps_;
        creatorFeeShareBps = creatorFeeShareBps_;
        gradCreatorShareBps = gradCreatorShareBps_;
        treasury = treasury_;
        emit FeeConfigUpdated(creationFee_, tradeFeeBps_, graduationFeeBps_, creatorFeeShareBps_, gradCreatorShareBps_, treasury_);
    }

    function _setCurveParams(uint256 totalSupply_, uint16 lpBps_, uint256 fundingGoal_, uint256 virtualTokenReserve_)
        internal
    {
        if (totalSupply_ == 0) revert InvalidParam();
        if (lpBps_ < MIN_LP_BPS || lpBps_ > MAX_LP_BPS) revert InvalidParam();
        if (fundingGoal_ < MIN_FUNDING_GOAL) revert InvalidParam();
        // bound to uint128 so the per-curve struct can pack safely
        if (totalSupply_ > type(uint128).max || fundingGoal_ > type(uint128).max || virtualTokenReserve_ > type(uint128).max) {
            revert InvalidParam();
        }

        uint256 _maxSupplyForSale = totalSupply_ - CurveMath.share(totalSupply_, lpBps_);
        if (_maxSupplyForSale == 0) revert InvalidParam();
        // require a comfortable margin so curve denominators stay strictly positive (>= ~1.01x)
        if (virtualTokenReserve_ < _maxSupplyForSale + _maxSupplyForSale / 100) revert CurveInconsistent();

        // Derive the virtual native reserve so the cumulative raised at maxSupplyForSale
        // is >= fundingGoal (round up), i.e. the curve graduates by the funding goal at or
        // just before selling out — never with the funding goal unreachable.
        uint256 ve = Math.mulDiv(
            fundingGoal_, virtualTokenReserve_ - _maxSupplyForSale, _maxSupplyForSale, Math.Rounding.Ceil
        );
        if (ve == 0) revert CurveInconsistent();
        if (ve > type(uint128).max) revert CurveInconsistent();
        if (CurveMath.raisedAt(_maxSupplyForSale, ve, virtualTokenReserve_) < fundingGoal_) revert CurveInconsistent();

        tokenTotalSupply = totalSupply_;
        lpBps = lpBps_;
        fundingGoal = fundingGoal_;
        virtualTokenReserve = virtualTokenReserve_;
        virtualEthReserve = ve;
        emit CurveParamsUpdated(totalSupply_, lpBps_, fundingGoal_, ve, virtualTokenReserve_);
    }

    function _setAntiBot(uint256 maxBuyPerTx_, uint16 maxWalletBps_, uint32 tradeCooldown_) internal {
        if (maxWalletBps_ > BPS) revert InvalidParam();
        if (maxBuyPerTx_ > type(uint128).max) revert InvalidParam();
        maxBuyPerTx = maxBuyPerTx_;
        maxWalletBps = maxWalletBps_;
        tradeCooldown = tradeCooldown_;
        emit AntiBotUpdated(maxBuyPerTx_, maxWalletBps_, tradeCooldown_);
    }

    function _setDexRouter(address router_) internal {
        if (router_ == address(0)) revert InvalidParam();
        // sanity: the router must expose factory()/WETH()
        address f = IUniswapV2Router02(router_).factory();
        address w = IUniswapV2Router02(router_).WETH();
        if (f == address(0) || w == address(0)) revert InvalidParam();
        dexRouter = router_;
        emit DexRouterUpdated(router_);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Accept native from the Uniswap router (ETH refund on addLiquidityETH)
    ///         and any forced transfers; nothing else relies on bare transfers reaching us.
    receive() external payable {}
}
