import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, push, onValue, remove, child } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytesResumable, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';
import { firebaseConfig } from './firebaseConfig';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const database = getDatabase(app);
export const storage = getStorage(app);

// Global pair ID, now mutable via setPairId
export let PAIR_ID = 'Noam_Bar_2026';

export const setPairId = (id: string) => {
  PAIR_ID = id;
};

// Helper references for common paths
export const getPairNode = (node: string) => ref(database, `${node}/${PAIR_ID}`);

export { ref, get, set, update, push, onValue, remove, child, storageRef, uploadBytesResumable, uploadBytes, getDownloadURL, uploadString };
