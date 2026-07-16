// src/firebase.js
// Native Firebase modules. On Android the app is configured automatically from
// google-services.json (copied by the @react-native-firebase/app Expo config plugin).
// On iOS it reads GoogleService-Info.plist. No manual JS config is required.
import firebase from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

// Ensure the default app is initialized.
if (!firebase.apps.length) {
  firebase.initializeApp();
}

export { firebase, auth, firestore };
export default firebase;
