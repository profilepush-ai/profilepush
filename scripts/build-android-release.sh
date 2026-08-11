#!/bin/zsh

set -euo pipefail

readonly service_prefix="com.profilepush.android-signing"
readonly account_name="${USER}"

keychain_value() {
  security find-generic-password -a "$account_name" -s "$1" -w 2>/dev/null
}

export ANDROID_KEYSTORE_PATH="$(keychain_value "$service_prefix.keystore-path")"
export ANDROID_KEYSTORE_PASSWORD="$(keychain_value "$service_prefix.store-password")"
export ANDROID_KEY_ALIAS="$(keychain_value "$service_prefix.key-alias")"
export ANDROID_KEY_PASSWORD="$(keychain_value "$service_prefix.key-password")"
export ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-2}"
export ANDROID_VERSION_NAME="${ANDROID_VERSION_NAME:-1.0.1}"

if [[ ! -f "$ANDROID_KEYSTORE_PATH" ]]; then
  print -u2 "Configured keystore not found: $ANDROID_KEYSTORE_PATH"
  exit 1
fi

print "Building signed Android release ${ANDROID_VERSION_NAME} (${ANDROID_VERSION_CODE})..."
npm run mobile:android:bundle

readonly bundle_path="$PWD/android/app/build/outputs/bundle/release/app-release.aab"
signature_result="$(jarsigner -verify -verbose -certs "$bundle_path" 2>&1)"
if [[ "$signature_result" != *"jar verified."* ]]; then
  print -u2 "Release bundle is unsigned."
  exit 1
fi

print "Signed bundle: $bundle_path"