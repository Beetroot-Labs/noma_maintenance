import { labelingFeatures, productNames } from "@noma/shared";

const features = [
  "Belepes es jogosultsagkezeles",
  "Vonalkod beolvasas vagy kezi megadas",
  "Gyors eszkoz-azonositas",
  "Uj barcode hozzarendeles",
  "Eszkozfoto feltoltes",
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">{productNames.labeling}</p>
        <h1>Mobile-first labeling frontend</h1>
        <p className="intro">
          This app is the dedicated frontend for barcode replacement, device lookup,
          and photo capture on {productNames.main.toLowerCase()}.
        </p>
      </section>

      <section className="panel">
        <h2>Planned shared capabilities</h2>
        <ul>
          {labelingFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Initial labeling scope</h2>
        <ul>
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
