# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is taken from `package.json`.

## [Unreleased]

### Added

- Native CloudSync layer and live protocol connect (M001/S01/T01–T08): a Room persistence layer for scan
  snapshots, the CloudSync TurboModule registered in `MainApplication`, read-only FTP, SFTP and WebDAV
  clients that discover each server's real timestamp precision, SFTP host-key trust-on-first-use with an
  explicit approve/reject challenge, Android Keystore-backed credential storage that keeps passwords out of
  Room, and fixes to the validation scripts (D015).
