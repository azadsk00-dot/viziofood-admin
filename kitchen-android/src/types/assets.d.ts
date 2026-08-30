// Metro asset modules — importing a sound yields its numeric Android
// resource id, which expo-notifications' setNotificationChannelAsync accepts
// as the channel sound (it resolves to
// android.resource://<package>/<resId>).
declare module '*.wav' {
  const value: number;
  export default value;
}

declare module '*.mp3' {
  const value: number;
  export default value;
}
