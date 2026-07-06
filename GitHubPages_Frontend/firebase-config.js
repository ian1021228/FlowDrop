import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCbTCPeuXlpm6WH8HZwAc7f45hckYvdseA",
  authDomain: "flydrop-691bb.firebaseapp.com",
  projectId: "flydrop-691bb",
  storageBucket: "flydrop-691bb.firebasestorage.app",
  messagingSenderId: "209916357825",
  appId: "1:209916357825:web:477e1c3fd444126d2bb840"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { auth, provider };
