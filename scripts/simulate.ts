import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { coordinateAt } from "../shared/engine";
import type { Journey } from "../shared/domain";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
initializeApp({ projectId: "demo-smartrail-bd" });
async function main() {
  const data = await getFirestore().collection("journeys").get();
  const journey = data.docs
    .map((d) => d.data() as Journey)
    .filter((j) => j.expiresAt > Date.now())
    .sort((a, b) => b.departureMs - a.departureMs)[0];
  if (!journey) throw new Error("Run pnpm seed first");
  let distance = 0;
  console.log(
    `Sending GPS to local emulator for ${journey.id}. Stop with Ctrl+C.`,
  );
  for (let sequence = Date.now(); distance < 91000; sequence++) {
    const timestamp = Date.now();
    const response = await fetch(
      "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api/gps",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "local-demo-device-key",
        },
        body: JSON.stringify({
          ...coordinateAt(journey.route, distance),
          journeyId: journey.id,
          deviceId: "demo-gnss",
          source: "primary",
          timestamp,
          sequence,
          accuracyM: 8,
        }),
      },
    );
    console.log(response.status, await response.text());
    if (!response.ok) throw new Error("GPS rejected");
    distance += 100;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
