#!/bin/zsh

set -euo pipefail

readonly service_prefix="com.profilepush.android-signing"
readonly account_name="${USER}"
readonly default_keystore="$PWD/android/keystore/profilepush-upload.jks"
readonly default_alias="uploadkey561febd5"

keychain_value() {
  security find-generic-password -a "$account_name" -s "$1" -w 2>/dev/null
}

keystore_path="$(keychain_value "$service_prefix.keystore-path" || true)"
key_alias="$(keychain_value "$service_prefix.key-alias" || true)"
store_password="$(keychain_value "$service_prefix.store-password" || true)"

if [[ -z "$keystore_path" || -z "$key_alias" || -z "$store_password" ]] || ! keytool -list -keystore "$keystore_path" -storepass "$store_password" -alias "$key_alias" >/dev/null 2>&1; then
  read "keystore_path?Keystore path [$default_keystore]: "
  keystore_path="${keystore_path:-$default_keystore}"
  read "key_alias?Key alias [$default_alias]: "
  key_alias="${key_alias:-$default_alias}"

  if [[ ! -f "$keystore_path" ]]; then
    print -u2 "Keystore not found: $keystore_path"
    exit 1
  fi

  read -s "store_password?Keystore password: "
  print
  if ! keytool -list -keystore "$keystore_path" -storepass "$store_password" -alias "$key_alias" >/dev/null 2>&1; then
    print -u2 "The keystore password or alias is incorrect. Nothing was saved."
    exit 1
  fi
else
  print "Using the validated keystore configuration already stored in macOS Keychain."
fi

if [[ ! -f "$keystore_path" ]]; then
  print -u2 "Keystore not found: $keystore_path"
  exit 1
fi

read -s "key_password?Key password (press Enter if same as keystore password): "
print
key_password="${key_password:-$store_password}"

validation_dir="$(mktemp -d)"
trap 'rm -rf "$validation_dir"' EXIT
print "ProfilePush signing validation" > "$validation_dir/content.txt"
jar --create --file "$validation_dir/validation.jar" -C "$validation_dir" content.txt
if ! jarsigner -keystore "$keystore_path" -storepass "$store_password" -keypass "$key_password" "$validation_dir/validation.jar" "$key_alias" >/dev/null 2>&1; then
  print -u2 "The private-key password is incorrect. Nothing was saved."
  exit 1
fi

security add-generic-password -U -a "$account_name" -s "$service_prefix.store-password" -w "$store_password" >/dev/null
security add-generic-password -U -a "$account_name" -s "$service_prefix.key-password" -w "$key_password" >/dev/null
security add-generic-password -U -a "$account_name" -s "$service_prefix.keystore-path" -w "$keystore_path" >/dev/null
security add-generic-password -U -a "$account_name" -s "$service_prefix.key-alias" -w "$key_alias" >/dev/null

unset store_password key_password
print "Android signing credentials saved in macOS Keychain."
print "Run: npm run mobile:android:bundle:signed"