import { TokenCreateForm } from "@/components/token/token-create-form";

export const metadata = {
  title: "Create Token | LCAI Launchpad",
  description: "Launch a new memecoin on Lightchain AI.",
};

export default function CreateTokenPage() {
  return (
    <section className="lclp-section-gap">
      <div className="container mx-auto px-4">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold capitalize">
            Launch your <span className="theme-gradient">token</span> on
            <br />
            lighthcain
          </h1>
        </div>
        <TokenCreateForm />
      </div>
    </section>
  );
}
