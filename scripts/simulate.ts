// The simulator sends admin-authorized commands; coordinates and virtual clock are computed on the backend.
const base = "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api";
async function main() {
  const login = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@smartrail.test",
        password: "DemoRail2026!",
        returnSecureToken: true,
      }),
    },
  ).then((r) => r.json());
  if (!login.idToken) throw new Error("Run pnpm seed first");
  async function post(path: string, body: unknown) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${login.idToken}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  const date = new Date(Date.now() + 21600000).toISOString().slice(0, 10);
  const { journey } = await post("/journey", {
    scheduleId: "701-0800",
    serviceDate: date,
  });
  await post("/mock-tickets", { journeyId: journey.id });
  console.log(
    `Journey ${journey.id}; fake tickets imported. Open the passenger map. Ctrl+C stops simulation.`,
  );
  for (let step = 0; step < 60; step++) {
    const action = step === 3 ? "HOLD" : "STEP";
    const { live } = await post("/simulate", { journeyId: journey.id, action });
    console.log(
      `${action}: ${live.progress.progressPercent.toFixed(1)}%; next ${live.progress.nextPointId}; Biman Bandar delay ${live.stationPredictions.airport.delayMinutes} min`,
    );
    if (live.completed) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
