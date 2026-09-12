import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";
let client: ReturnType<typeof createClient> | undefined;
function createClient() {
  const app =
    getApps()[0] ||
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
      authDomain:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
        "demo-smartrail-bd.firebaseapp.com",
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-smartrail-bd",
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
        "https://demo-smartrail-bd-default-rtdb.firebaseio.com",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "demo-app",
    });
  const auth = getAuth(app),
    firestore = getFirestore(app),
    database = getDatabase(app);
  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== "false") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    connectDatabaseEmulator(database, "127.0.0.1", 9000);
  }
  return { auth, firestore, database };
}
export function firebaseClient() {
  return (client ??= createClient());
}
export async function api(path: string, body: unknown) {
  const token = await firebaseClient().auth.currentUser?.getIdToken();
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api"}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
