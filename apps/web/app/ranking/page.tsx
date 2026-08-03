import { RankingTable } from "@/components/ranking/ranking-table";

export const metadata = {
  title: "Ranking | LCAI Launchpad",
  description: "Top memecoins by market cap on Lightchain AI.",
};

export default function RankingPage() {
  return <RankingTable />;
}
