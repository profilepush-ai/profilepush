# Mobile Release Checklist

## Current status
- Android compile/target SDK: API 36 (Android 16)
- Android AAB build: PASS
- Android env-driven signing/version config: PASS
- iOS build toolchain on this machine: FAIL (Xcode + CocoaPods missing)

## Android release steps
1. In Google Play Console, note the highest uploaded version code.
2. Set release env vars from .env.mobile.release.example in your shell. `ANDROID_VERSION_CODE` must be higher than the Play Console value.
3. Confirm all four signing variables are set; unsigned bundles cannot be uploaded.
4. Build bundle:

   ```bash
   npm run mobile:android:bundle
   ```

5. Verify output and signature:

   ```bash
   ls -lh android/app/build/outputs/bundle/release/app-release.aab
   jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
   ```

   The output must not say `jar is unsigned`.
6. Upload the AAB to an internal, closed, or open testing track and confirm Play reports target API 36.
7. Promote the tested release to production before the Google Play deadline.

## iOS release steps
1. Install full Xcode from App Store.
2. Point xcode-select to Xcode:
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
3. Install CocoaPods:
   gem install cocoapods
   # or
   brew install cocoapods
4. Sync native dependencies:
   npm run mobile:sync
5. Open iOS project and archive in Xcode:
   npm run mobile:ios:open

## Notes
- If Android signing env vars are missing, Gradle builds still run but release signing config is not attached.
- iOS sync will fail until both xcodebuild and pod are available.
