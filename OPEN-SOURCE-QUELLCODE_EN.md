# Source code and licenses for redistributed open-source dependencies

[**Deutsch 🇩🇪**](OPEN-SOURCE-QUELLCODE.md) · **English 🇬🇧**

## Simpliy Slicing 0.0.0-alpha.1

Simpliy Slicing uses libraries under a variety of open-source licenses. Its own independently developed user interface and functionality are not automatically open-sourced because these libraries are used.

### MPL-2.0 dependencies in the Windows build

The following Rust crates are recorded as MPL-2.0 dependencies in the dependency inventory (`Cargo.lock` / `cargo tree`) of the `0.0.0-alpha.1` Windows build:

| Component | Version | Upstream source |
|---|---|---|
| cssparser | 0.37.0 | https://crates.io/crates/cssparser/0.37.0 |
| cssparser-macros | 0.7.1 | https://crates.io/crates/cssparser-macros/0.7.1 |
| dtoa-short | 0.3.5 | https://crates.io/crates/dtoa-short/0.3.5 |
| option-ext | 0.2.0 | https://crates.io/crates/option-ext/0.2.0 |
| selectors | 0.38.0 | https://crates.io/crates/selectors/0.38.0 |

Their complete source code is available in the release archive [`Simpliy-Slicing-0.0.0-alpha.1-MPL-Sources.zip`](../../releases/download/v0.0.0-alpha.1/Simpliy-Slicing-0.0.0-alpha.1-MPL-Sources.zip). The ZIP contains the unmodified upstream `.crate` archives (tar.gz source packages), the MPL-2.0 license, and SHA-256 checksums.

**Original license text:** https://www.mozilla.org/en-US/MPL/2.0/

Other libraries bundled with Simpliy are distributed under MIT, Apache-2.0, BSD, ISC, and additional licenses. Their corresponding notices and license obligations also apply. Providing the MPL archive alone does **not** constitute a complete audit of all third-party licensing obligations.

### PrusaSlicer

The PrusaSlicer engine is **not distributed as part of Simpliy Slicing** and must be installed separately. PrusaSlicer is licensed under the **GNU AGPLv3**; its original source is at https://github.com/prusa3d/PrusaSlicer.

The origin of Simpliy's Prusa-compatible format implementations has not yet been conclusively reviewed for possible reuse of copyright-protected implementation code. Publishing the MPL dependency sources is **not evidence** that every other copyleft question concerning Simpliy's modules has been resolved.

### Notice

This page records the technical source-code availability for the MPL dependencies identified in this build. It is not a legal approval. If dependencies change in later builds, the source archive and license notices must be updated accordingly.
