# 镜像清单 · 第二信息源《Rust 程序设计语言》中文版（ticket 18）

本目录是 **rust-lang-cn/book-cn** 的镜像，是「验证 any」的第二个信息源。选它的刻意性：
它是 **mdBook 节级粒度**——105 个 .md，一个文件≈一小节（第一源是「一个文件=一章」，13 个）。
「文件=章」的隐藏假设会在全链路上被这套结构打出来。

## 来源与口径

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/rust-lang-cn/book-cn` |
| 钉住的 commit | `cde74c448e301ce8ac7960a0d3dc879efd83635d`（2026-04-16） |
| 取法 | blobless partial clone + `sparse-checkout set src` |
| 镜像日期 | 2026-10-14 |
| 范围 | `src/` 下**全部 105 个 .md**（含 SUMMARY.md 与附录）；`src/img/` 图片**未镜像**（正文管线只读文本，图片引用在正文里作为文本链接存在） |

⚠ **只读镜像，不得就地修改。** 源键约定见 `anchor-index.mjs` 的 `sourceBookRoot`：
本目录对应源键 `rust-book-cn`（`sources/rust-book-cn/book/`）。

## 逐文件哈希（105 行即全部）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `SUMMARY.md` | 6606 | `sha256:138c8217ddae3f08764e500932bd726054772302407bb5c00ceeda020cdacd8a` |
| `appendix-00.md` | 89 | `sha256:f39c9ba75d7b063edc56737a6cb6a36336fe2a5e19f2abb09f5955ad1e62dbc6` |
| `appendix-01-keywords.md` | 4333 | `sha256:68046894de5fec4d47884593d0e19d518cb92adf560c99ed5ad2503262d60f29` |
| `appendix-02-operators.md` | 9079 | `sha256:1047b241fa7fcbd129adbf408c7cdaf17f4fd69dc927265f418a9bd5c770e41d` |
| `appendix-03-derivable-traits.md` | 8603 | `sha256:3d5593ffd5b8314aaa71f7fc188ed034d2d4d4186d28e03da59b8533a06e7c0a` |
| `appendix-04-useful-development-tools.md` | 4646 | `sha256:a5b2ce9bade987a911658a87c062cef13eed421aa1545bf1ff2a40bfe1255d5b` |
| `appendix-05-editions.md` | 2656 | `sha256:f591772547ead9d2e1f32e67b3fb8ec16d529ed57155e74d140f970acb8fbffb` |
| `appendix-06-translation.md` | 1710 | `sha256:ee17c76c50aeb5b03f45c1f1caf26b6e281e41172de1fd1cb0127123fd00c44e` |
| `appendix-07-nightly-rust.md` | 8393 | `sha256:211bc530a19ed62d7d5d824ccc19664de34e1190175c4d7a74885943655a009e` |
| `ch00-00-introduction.md` | 9220 | `sha256:2a225034ad6387c3fb1ccf8355540b509393032f72b23b0e5f3ca2480c802881` |
| `ch01-00-getting-started.md` | 300 | `sha256:3c5bc0dbcb3744cc04580463f7c3574eb0de7fc5687d0d49edb96a5270a8c79e` |
| `ch01-01-installation.md` | 4667 | `sha256:3438616a97ce96658ebbc47656c3ae69920cb9c13244cf54bc0c1ce5337367ba` |
| `ch01-02-hello-world.md` | 7001 | `sha256:16e9f15d29a3c2ed1d021459ab5bac0e44ed5283f2747fdd0d99984893a1ff20` |
| `ch01-03-hello-cargo.md` | 9847 | `sha256:20e495b804b420db7fc9e0b173115322a63a6205f7b77741cff9779f1b528e4f` |
| `ch02-00-guessing-game-tutorial.md` | 36082 | `sha256:a8bfb6dbfe83a9cc8f992b9b627d969c442b73ac02517f6f8e70fab2c0aa69c6` |
| `ch03-00-common-programming-concepts.md` | 1047 | `sha256:ecd8983eb107691341955bc8d7b5a068ce2daeb312e1161afcbfed1b8d79ad71` |
| `ch03-01-variables-and-mutability.md` | 8791 | `sha256:41ba092930c9594a09aad3a72ee7b18fcab23f7e3274d3d9cc29f80bdaa922bf` |
| `ch03-02-data-types.md` | 16437 | `sha256:c78de3a0cae100d704b7e021dd8f34957b7690fbd763883b2f8fe823e57219c8` |
| `ch03-03-how-functions-work.md` | 9748 | `sha256:aa9237776fbc40223f50646ab51c044e10ba15ea802fa782a6c2c72def2793a6` |
| `ch03-04-comments.md` | 1342 | `sha256:a8c79107c40a1e59621943677295d07a6ebe5ad993980be3e7bc4db09f80660c` |
| `ch03-05-control-flow.md` | 15065 | `sha256:e002508b3a37c634506725609e163971c4fef6d78f0a2662b6ec31684972957f` |
| `ch04-00-understanding-ownership.md` | 346 | `sha256:e56d6ce63808e2824907f019e041ad96838b69ee989672526941c5db1dc55dee` |
| `ch04-01-what-is-ownership.md` | 21477 | `sha256:9d05bf34231df2f0f5dbc4061ccb032815d1b5b66d1e3b1f2dcc895da6362e0d` |
| `ch04-02-references-and-borrowing.md` | 9723 | `sha256:113caf47d6970586d7725c60ea25e7570dbc306619071f0dae10da6cf308f05f` |
| `ch04-03-slices.md` | 12016 | `sha256:dd6f1aa6f2852e759f9cd442c4eabe1f3d6b2e7f23d373b59514ae42eefe857f` |
| `ch05-00-structs.md` | 674 | `sha256:a45fa5780a88f10924891dea46f582820ef926a0358492b08de14be45b6380ca` |
| `ch05-01-defining-structs.md` | 12008 | `sha256:bb41b4f5c8c4c48cad6b6bc0901292d85261abe5d55561e6a1eca4ad4338f62e` |
| `ch05-02-example-structs.md` | 10695 | `sha256:0d26eb1e6e764967aefea131e582c49227036c45f12569111870bb10c1df603b` |
| `ch05-03-method-syntax.md` | 10640 | `sha256:0f835eb7fe56bbbac6c0ba7e47d771858ed10e7fff847c5087f10f57581fe2a6` |
| `ch06-00-enums.md` | 850 | `sha256:8d152d92bde0d680cd2ad972c7a1281545406c27902320df693218f382731d04` |
| `ch06-01-defining-an-enum.md` | 13532 | `sha256:757a14c8724baabfe6ad89c8c6275a3c8e8ac85c007fc21e66623a1be8fb97c8` |
| `ch06-02-match.md` | 11389 | `sha256:8a1eb0b0bfaf1a44c98dccad4c22bed80f30010b9db6c5cbb139b3af663a0099` |
| `ch06-03-if-let.md` | 3619 | `sha256:9e982eef4e66b2e4ebab6f1f05551e8ff4f14c1d0e3796d8c930f1d2505ac111` |
| `ch07-00-managing-growing-projects-with-packages-crates-and-modules.md` | 2904 | `sha256:be41480e31809064a382cf7067f66334e2bb98160311c0a97d52ca27a93adc25` |
| `ch07-01-packages-and-crates.md` | 3289 | `sha256:9564841164a75389fd3696e24a1957ecf22d804b4330441012c9a47e1455d981` |
| `ch07-02-defining-modules-to-control-scope-and-privacy.md` | 3994 | `sha256:8a816f35c09847434252e50dcc5c2c08c81dd2baf3b24e6e7c1cd4fe124c8777` |
| `ch07-03-paths-for-referring-to-an-item-in-the-module-tree.md` | 12617 | `sha256:ab7141ee09838b6715daf548c45adb7a49a9769c95253d2f33f1fc3aacbf0225` |
| `ch07-04-bringing-paths-into-scope-with-the-use-keyword.md` | 11905 | `sha256:8f8dd6c0e2cc1ca8f64c29449b38a3fe036d62f056d5873951d23820bd104a00` |
| `ch07-05-separating-modules-into-different-files.md` | 2949 | `sha256:a0e41eb2fd12d7a945b72227907c82a8f796e6add03daf04e9dcdde22eb8cd8d` |
| `ch08-00-common-collections.md` | 1263 | `sha256:1c26552b369c5d511c0fdcc21ec25689f77ab5b9a2a69831f6470414090b58ce` |
| `ch08-01-vectors.md` | 10566 | `sha256:b05ea291d88d5143ed4a6d8870fe7bd4d243768928fb08da134e01c8862256e6` |
| `ch08-02-strings.md` | 16847 | `sha256:de01fd74ce800807a66452f302576215e13a57911c31ecdc4e828042a8adc0a3` |
| `ch08-03-hash-maps.md` | 11274 | `sha256:21d0921b5927c6b2f3ee6664f3e37a9f4bc253e20b7c322a3b53fb7292c3fca9` |
| `ch09-00-error-handling.md` | 1182 | `sha256:2e1beda7552203d12394a299383382b55ef86edcb64028cb59a3cda00114a9f2` |
| `ch09-01-unrecoverable-errors-with-panic.md` | 8407 | `sha256:e0def55363eb20d503aea533d0ff1e42dd1dc6098e66f3e27582780b472b05cc` |
| `ch09-02-recoverable-errors-with-result.md` | 19922 | `sha256:054f6747418cece9d2102d1bdc557b997c9be633d9fc70431b1928ae8cf9dc3e` |
| `ch09-03-to-panic-or-not-to-panic.md` | 11566 | `sha256:082c63fc9cbcfeaa6d929f82a28eb6d564d0c8c25ffd4248c62c3e4d75b2174b` |
| `ch10-00-generics.md` | 6127 | `sha256:ce32908c915545ed807e0f16322266de6a21cce0c1f0dc73c77b3d908aa585c9` |
| `ch10-01-syntax.md` | 15120 | `sha256:e2f9b97ccc259ac64c927a3b421397d75fd8b3b1cdffeaed68f8772b18bf9ef5` |
| `ch10-02-traits.md` | 22529 | `sha256:9f2092fcdbed3beba5231e86b090e0fcea7d5692cf93832c62facbd176a84e2a` |
| `ch10-03-lifetime-syntax.md` | 30321 | `sha256:2e9cade0054ac54074f8c68f248e086ff10ee8c04ac38535473f3152b3319916` |
| `ch11-00-testing.md` | 1921 | `sha256:639a268db5e0dea3bc7be0e3ae5b5b06b668007a65124a5691f3ee330039d945` |
| `ch11-01-writing-tests.md` | 26802 | `sha256:bd390be4e661e1f04fd790ef619712de2fc1105b121226c1b789b00ff1ea31b3` |
| `ch11-02-running-tests.md` | 8740 | `sha256:cd688652da16ad8d7fdfc090d4f0a8b390073764e712782338c2e0240a701d15` |
| `ch11-03-test-organization.md` | 12160 | `sha256:827ace11666d01eaaf133511371885ec4fede79768616e549301e7519275892a` |
| `ch12-00-an-io-project.md` | 2245 | `sha256:e79969e6bd5e89076fa5b90f5f030dc475f9cf815748b13e47eaf0c05c282f3d` |
| `ch12-01-accepting-command-line-arguments.md` | 5762 | `sha256:8570896d12ab1dcf8415cf5db2929eb5ed942a0d5dc50d35054b6f5e6bdca699` |
| `ch12-02-reading-a-file.md` | 3212 | `sha256:60c78f409bcfd12c7726463c555ed8defadc32fcf8f5e3aa7d9dad3daccee840` |
| `ch12-03-improving-error-handling-and-modularity.md` | 25096 | `sha256:806f98dfacede0237d4e7d72f06e299576cf2d71c5979fc22874d95f327395d7` |
| `ch12-04-testing-the-librarys-functionality.md` | 11477 | `sha256:8dec8f319350182a8e344ec302297cf1bfb089ae03091703ff660385f0dba351` |
| `ch12-05-working-with-environment-variables.md` | 10202 | `sha256:442a7d88c92851eff025ea08b45b523f174f9a9370a38cfea4b2456013d5f04b` |
| `ch12-06-writing-to-stderr-instead-of-stdout.md` | 4384 | `sha256:d721ecbafcc15c94f340219a36b35e0afb7370472b006180971a4337e7c55bd2` |
| `ch13-00-functional-features.md` | 1126 | `sha256:2f66331702b37d75d17632c20a15004af86314f752ec2dfd9326541edec55088` |
| `ch13-01-closures.md` | 28321 | `sha256:9a4cb661649dd4f3b823d3f0bbafad2932039bece980445e0d3f63f45bc22822` |
| `ch13-02-iterators.md` | 15825 | `sha256:b595e3aee636927ab1dffb59f1d501b46c6b757b0f931fe35dbd0525efcd0bc4` |
| `ch13-03-improving-our-io-project.md` | 8212 | `sha256:cafa571f389c4dfd38dc5956d5b0ae8a35da36652fcf38012a995d8eebc59539` |
| `ch13-04-performance.md` | 4678 | `sha256:e3707a7fd2f1d9a581c5b7dfd2322f5968f3e5c2532ad94fab96f4def0b05408` |
| `ch14-00-more-about-cargo.md` | 619 | `sha256:f6bd8517b7472edb9678f9d6cb17aef2770f9f299435463a51cc2045dc8610c2` |
| `ch14-01-release-profiles.md` | 2666 | `sha256:6c5bdbe5e8dd1a79866f78fba22baa1310e0f225e52ce689089ecfbfd32938da` |
| `ch14-02-publishing-to-crates-io.md` | 18594 | `sha256:fcad946a6828dd5de8a51d12dbc836b8800a14e25466a20d422d16448ef69e35` |
| `ch14-03-cargo-workspaces.md` | 10080 | `sha256:585a1f70c9bbb92acb8677e0f71aade8577d45fa7307a2c7f5138deef5a8257a` |
| `ch14-04-installing-binaries.md` | 1704 | `sha256:b66d33fc84e01386041262584a65fa7c088f2b90540b277533d9ab11b5632739` |
| `ch14-05-extending-cargo.md` | 973 | `sha256:d3aae51de2f0e0cd82e8e817f164040a880e75f2bc8303d2de4aff2ab87d646c` |
| `ch15-00-smart-pointers.md` | 2835 | `sha256:d86e9ab998bbc8ee582ac91825a5098a5a0e0b5655760d010babfaba939301b8` |
| `ch15-01-box.md` | 10984 | `sha256:b77b682f44471ff1df0be054256af4ba5d229b4b7224b1963397ca2975ba7431` |
| `ch15-02-deref.md` | 13285 | `sha256:8aa9f336162cafc017c1de4d0299db791cee81d699337f814eafd52a5faa2849` |
| `ch15-03-drop.md` | 7171 | `sha256:544f0b679c0544f8d656a80e7d139a348c2fd70d725e40530ba333883ae21540` |
| `ch15-04-rc.md` | 8342 | `sha256:0449ada0a942be8c037dce90637770e9aff45d502547a39ec8ddcd76f40b03e1` |
| `ch15-05-interior-mutability.md` | 20041 | `sha256:f5b5e67d5efa0ce6944cae99898883db9c07ef1e042339eea2588f427fe708da` |
| `ch15-06-reference-cycles.md` | 17733 | `sha256:5047b3eace7050487da636aa4fa7c38973111b47928deba85ed5aa3453c776c2` |
| `ch16-00-concurrency.md` | 2672 | `sha256:03ef6e4de7dba90d3752ad87c580e06728d90ff344c943e56717e0a0ef4cd60f` |
| `ch16-01-threads.md` | 14203 | `sha256:71543fe7a36a82025e702e7968d9b9396091d2209c45a4f08e6eb332f230aa79` |
| `ch16-02-message-passing.md` | 12014 | `sha256:05cc876c666c8cc47d649215d17d556bdd9f47f6195c1f9c211b5ce2551fd321` |
| `ch16-03-shared-state.md` | 13211 | `sha256:8e3cae7ded67ccc3f09f7d43ebb3c0643906296bcfa651a69ec7c53e25056034` |
| `ch16-04-extensible-concurrency-sync-and-send.md` | 4441 | `sha256:f5eec198c55496c03e39868a1db5de9a36102877cbc27976347e29b58aec0eef` |
| `ch17-00-oop.md` | 789 | `sha256:e6317b4621a8f34a9e003cfb339570fc69fa64d8fa8a16e3f3668fd29bddf0a2` |
| `ch17-01-what-is-oo.md` | 8043 | `sha256:9138812acd94e68b22a6e63b9a86f3a4a9334db6070f6d32736c329648866de6` |
| `ch17-02-trait-objects.md` | 15806 | `sha256:911a834b537a56d87a143df3abfb1347cc6dcd291e11362c3d49fee20051ccf1` |
| `ch17-03-oo-design-patterns.md` | 25857 | `sha256:a7bb85efe9e189efdbdbd1420efdf6e6879c304a7b98ba42922a45fc665a2a7f` |
| `ch18-00-patterns.md` | 1161 | `sha256:b8fc49ef7c122d408ea1c33e47eabb8a09986c2d0ddafa49106f35f2a05b66a6` |
| `ch18-01-all-the-places-for-patterns.md` | 9839 | `sha256:c24ae69ac3b439ff30bfea9302cecd601c4d65fbfb56a698e77ee85aded14878` |
| `ch18-02-refutability.md` | 4126 | `sha256:4c01937aca7647c34e2b1b3c21c8fe4cc4bef2e8affdc3f46dfcdfdc33f30572` |
| `ch18-03-pattern-syntax.md` | 26691 | `sha256:78d4d204762dfc4d90ecd02f02cd40a39359e69b1a1e8df604346bc0a6dcd729` |
| `ch19-00-advanced-features.md` | 1042 | `sha256:8ce3bf321e99f39887ae678c44068d7bcfb77626759f069088304b5f2319552f` |
| `ch19-01-unsafe-rust.md` | 22338 | `sha256:3468475c1c5f7e2458a46d7b755ae9c04e115ea1c075f1ee52056531a08908db` |
| `ch19-03-advanced-traits.md` | 22030 | `sha256:435743a59685c844fd735484bd6384eeb2aa2ae767c1b4cac5b759dd61e8834a` |
| `ch19-04-advanced-types.md` | 13322 | `sha256:9adf9bd9f4f6904102f4f544dfd850e5a570650a82cbd86f0e8e92540cf0e19a` |
| `ch19-05-advanced-functions-and-closures.md` | 5450 | `sha256:bb870959adaae59e2e3594c38ea08b46c59e621eeb30440282d60fafe9e7691f` |
| `ch19-06-macros.md` | 22888 | `sha256:5f0af383004c30dcf73522c8e0b29c4787a42354933a5d3f4d82486d84c7a2fa` |
| `ch20-00-final-project-a-web-server.md` | 1421 | `sha256:91b9c8c7a7efe2e3711026d090049cb0a5f1b8b6bf9a0cec96e91d060362f117` |
| `ch20-01-single-threaded.md` | 19001 | `sha256:5b2833450a83758946131acc1f29bc7c527445feab949da36ec9af6c96b7f994` |
| `ch20-02-multithreaded.md` | 36166 | `sha256:a32e43cd2f3a5485b2fa97bdbb21c6b76f1856e550c61abb49c4376178f3b513` |
| `ch20-03-graceful-shutdown-and-cleanup.md` | 17181 | `sha256:7de5c6dbfde8a04f929e5d9a0642ae8e3a800178a38c915c47caeb3267f10fd9` |
| `foreword.md` | 2090 | `sha256:3df97295f1406140ffee2e478ad5695c0e3435062f9e265434d40760b9880563` |
| `title-page.md` | 3196 | `sha256:257b206627abd25081e72775c17eea879929063edc135767a78a1a3b90991705` |

合计：**105 个文件 / 1,055,581 字节**。
