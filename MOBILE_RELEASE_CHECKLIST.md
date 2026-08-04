# Mobile Release Checklist

## Current status
- Android AAB build: PASS
- Android env-driven signing/version config: PASS
- iOS build toolchain on this machine: FAIL (Xcode + CocoaPods missing)

## Android release steps
1. Set release env vars from .env.mobile.release.example in your shell.
2. Build bundle:
   npm run mobile:android:bundle
3. Verify output file:
   android/app/build/outputs/bundle/release/app-release.aab

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
