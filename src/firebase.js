import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";

export const ALLOWED_DOMAIN = "bvrithyderabad.edu.in";

const firebaseConfig = {
  apiKey: "AIzaSyA3pgg2wthj8LBa1ApxclXeVin58zEpun8",
  authDomain: "campusconnect-dae35.firebaseapp.com",
  projectId: "campusconnect-dae35",
  storageBucket: "campusconnect-dae35.firebasestorage.app",
  messagingSenderId: "615946275746",
  appId: "1:615946275746:web:7974db4d95f7a5aa3000fb",
  measurementId: "G-97V72RBMDB",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  hd: ALLOWED_DOMAIN,
  prompt: "select_account",
});

export function isAllowedEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

export async function getMessagingIfSupported() {
  const supported = await isMessagingSupported();
  if (!supported) return null;
  return getMessaging(app);
}
