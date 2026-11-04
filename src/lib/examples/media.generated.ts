/**
 * Every published example file: its type, size, content hash and version (?v=), and for a file a run reads ("in") its
 * small inset copy, for an output its poster. Written by scripts/examples/publish-examples.mjs from plan.json: run it
 * again rather than editing. A published example file is never removed or renamed (a run may name it).
 */
export interface ExampleMediaFile {
  /** "in": a file a run may read (example-files.ts). "show": a display copy (an output, a poster, an inset). */
  role: "in" | "show";
  type: string;
  bytes: number;
  sha256: string;
  /** The content version its display URL ends in (?v=). */
  v: string;
  w?: number;
  h?: number;
  /** An input's inset copy (about 384 px), with its ?v=. */
  thumb?: string;
  /** An output's still (about 512 px), with its ?v=. */
  poster?: string;
}

export const EXAMPLE_MEDIA: Record<string, ExampleMediaFile> = {
 "/examples/app-3d-figure/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16266,
  "sha256": "248c95ed4e24ca54e0fbdce590f085428a9c918a0fa56b34fc3207a9a8544f57",
  "v": "248c95ed",
  "w": 384,
  "h": 288
 },
 "/examples/app-3d-figure/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109355,
  "sha256": "1220e4e1852bc2bc5c9f163e55eeffb2663415af135ad69b7d6a8acd9c612529",
  "v": "1220e4e1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-3d-figure/1/in-image.384.webp?v=248c95ed"
 },
 "/examples/app-3d-render/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22274,
  "sha256": "23b16b01b96cf4cf8ef756049b03bade411b4c255ecf3e250a888fb7102e0cae",
  "v": "23b16b01",
  "w": 384,
  "h": 288
 },
 "/examples/app-3d-render/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132600,
  "sha256": "0af770b7242563d00d612a7a200d55b209a26a2168a650926d93801c3a6cdef0",
  "v": "0af770b7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-3d-render/1/in-image.384.webp?v=23b16b01"
 },
 "/examples/app-3d-render/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33605,
  "sha256": "f71e7818c34fb92a7493b190f6a3dbef31a58ca2bed7e31a61ab438d57fb7161",
  "v": "f71e7818",
  "w": 512,
  "h": 384
 },
 "/examples/app-3d-rotation/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 3598,
  "sha256": "6f60f8bd3234ff2091a9fb0ae05e6dc4383b86a1e6f39d8509ce3f8bbca03f9b",
  "v": "6f60f8bd",
  "w": 384,
  "h": 288
 },
 "/examples/app-3d-rotation/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 37176,
  "sha256": "23c6a2a361bf3ccf753926950c7ea3cb8cd8c0798127e6a65f34ab3915c2ffb1",
  "v": "23c6a2a3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-3d-rotation/1/in-image.384.webp?v=6f60f8bd"
 },
 "/examples/app-60s-cafe/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20546,
  "sha256": "719a6e4608b4be4ef33dbf9ba36ff6fdab23725958dc91a58243c5ee7d63fee4",
  "v": "719a6e46",
  "w": 384,
  "h": 288
 },
 "/examples/app-60s-cafe/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 127568,
  "sha256": "ba4f5baaa9c8ac5dbc9a2be58e59e09d108724601992363cebf7545977e2ffb3",
  "v": "ba4f5baa",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-60s-cafe/1/in-image.384.webp?v=719a6e46"
 },
 "/examples/app-60s-cafe/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31001,
  "sha256": "451d30dc33c584dc15fe6285ab2892ea44c252c3319664aa657e28ad78417cbd",
  "v": "451d30dc",
  "w": 512,
  "h": 384
 },
 "/examples/app-age-shift/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10720,
  "sha256": "45d0dd3ea93a656b04c9a5880b528b3fa55eea996163b28e1ed6b80d33594cb4",
  "v": "45d0dd3e",
  "w": 384,
  "h": 288
 },
 "/examples/app-age-shift/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 97583,
  "sha256": "25601df0f7a87abc00b9dbc4b3126e2294f66e68bc5c110178f85410967d4902",
  "v": "25601df0",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-age-shift/1/in-image.384.webp?v=45d0dd3e"
 },
 "/examples/app-asmr-add-on/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10796,
  "sha256": "2657bb7d01340c2b1f205df10a9440a18febdbd29833803cd4e0d54a0db37854",
  "v": "2657bb7d",
  "w": 384,
  "h": 288
 },
 "/examples/app-asmr-add-on/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89079,
  "sha256": "81961e11eb8720977ddcec31ffc57d6c5390cb8e3594744672700d217822bb7d",
  "v": "81961e11",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-asmr-add-on/1/in-image.384.webp?v=2657bb7d"
 },
 "/examples/app-asmr-classic/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9410,
  "sha256": "515c67d84204939daed275f3a94984fbf79402148be3d54b33f0ef006186154a",
  "v": "515c67d8",
  "w": 384,
  "h": 288
 },
 "/examples/app-asmr-classic/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89465,
  "sha256": "b27841892b4718873c4564b98bbf64c929f94bc1bd6a1ada1c5cbb7e5a1a338b",
  "v": "b2784189",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-asmr-classic/1/in-image.384.webp?v=515c67d8"
 },
 "/examples/app-behind-the-scenes/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19188,
  "sha256": "f852abb85bf1e82080f26e2b0e981b8d92624bd5875f3a61086ee10f58f2f448",
  "v": "f852abb8",
  "w": 384,
  "h": 288
 },
 "/examples/app-behind-the-scenes/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 119901,
  "sha256": "3dd0e82e8e1b5520086e37dbfa41b0ffd271478031cfdf2dcd4a8a6a593040bb",
  "v": "3dd0e82e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-behind-the-scenes/1/in-image.384.webp?v=f852abb8"
 },
 "/examples/app-billboard-ad/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16650,
  "sha256": "9361fcedf6038002e221e658e2104b541e8de2b7c44efbe276516cb1a0021db5",
  "v": "9361fced",
  "w": 384,
  "h": 288
 },
 "/examples/app-billboard-ad/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126229,
  "sha256": "d6088988601a3d5a9546ce7441a7e18fab548e32014f64005ff823aa189be544",
  "v": "d6088988",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-billboard-ad/1/in-image.384.webp?v=9361fced"
 },
 "/examples/app-breakdown/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22450,
  "sha256": "248807d4c8e699bd9613504ad58c1bbd2ae35c4b20ca33d0ca52f31c16600a0b",
  "v": "248807d4",
  "w": 384,
  "h": 288
 },
 "/examples/app-breakdown/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 169589,
  "sha256": "7b9f31a6aa9ee8ba43cb2942a806d89a8abfc05557e9747de1b252e2ac455099",
  "v": "7b9f31a6",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-breakdown/1/in-image.384.webp?v=248807d4"
 },
 "/examples/app-bullet-time-scene/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21656,
  "sha256": "3ff8c6264ad328da6c2cda1b3497976b627648a5108c28bf5910d8dfa3efc0b2",
  "v": "3ff8c626",
  "w": 384,
  "h": 288
 },
 "/examples/app-bullet-time-scene/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 163534,
  "sha256": "a92afd39faf1938b17bfcb4fd92cd9ad8eabc6e5965a121b41ea7d128434e2a9",
  "v": "a92afd39",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-bullet-time-scene/1/in-image.384.webp?v=3ff8c626"
 },
 "/examples/app-bullet-time-scene/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 34274,
  "sha256": "b82ebb381f1bb1c3972cae55943c56efa59216733cd4dac55f4f3dd7ef6456e7",
  "v": "b82ebb38",
  "w": 512,
  "h": 384
 },
 "/examples/app-bullet-time-splash/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14732,
  "sha256": "abb8690102a0e2cbb365676151a220fc8c8fca628c1d5de20f042581aaa1cb0b",
  "v": "abb86901",
  "w": 384,
  "h": 288
 },
 "/examples/app-bullet-time-splash/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 112864,
  "sha256": "e80df4ff6a924f92790ba37de06782053d27f61666b807e25b793b2d813cedb4",
  "v": "e80df4ff",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-bullet-time-splash/1/in-image.384.webp?v=abb86901"
 },
 "/examples/app-bullet-time-splash/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 20152,
  "sha256": "534ca1345c1eb851d068459d87e698ccfd8144ccca0ffab00471a7af191e535e",
  "v": "534ca134",
  "w": 512,
  "h": 384
 },
 "/examples/app-burning-sunset/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12588,
  "sha256": "eb1ceeb8e364cac6b9513d33741f86718914c42048505e887844fa83966eeaa4",
  "v": "eb1ceeb8",
  "w": 384,
  "h": 288
 },
 "/examples/app-burning-sunset/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91550,
  "sha256": "a7d1bb642204fc54e9f3078518b2b8eccbd7a125dfee076a2b7c9661af8fac5a",
  "v": "a7d1bb64",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-burning-sunset/1/in-image.384.webp?v=eb1ceeb8"
 },
 "/examples/app-burning-sunset/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30038,
  "sha256": "2618430f1dde10feb83f8bb003572bd2199e74298f1e2792695249c752346d11",
  "v": "2618430f",
  "w": 512,
  "h": 384
 },
 "/examples/app-chameleon/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5080,
  "sha256": "bf33221f16349fa28ee446d39a6dcb3314aa1ac81cd3d98aecdcc3946c1eb2c4",
  "v": "bf33221f",
  "w": 384,
  "h": 288
 },
 "/examples/app-chameleon/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 54341,
  "sha256": "b2465f9c84eca91750cf536237f9265b3ac63e884a9e2adfaa9980e3bdcc7532",
  "v": "b2465f9c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-chameleon/1/in-image.384.webp?v=bf33221f"
 },
 "/examples/app-change-background/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5390,
  "sha256": "91bf52a4db6d812ca3ffd9445a60e6fb65383eea653d1d16a60dcfd1472dbcc0",
  "v": "91bf52a4",
  "w": 384,
  "h": 288
 },
 "/examples/app-change-background/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89441,
  "sha256": "93b630bc7d6264d48782a382e4260e97bf5d031f9445e796852aa0a4905c692e",
  "v": "93b630bc",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-change-background/1/in-image.384.webp?v=91bf52a4"
 },
 "/examples/app-clipcut/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5214,
  "sha256": "7141e6f3483b8c059bc79eb89b02b00aeaa642f53bd70086e853c9e1ae32b778",
  "v": "7141e6f3",
  "w": 384,
  "h": 288
 },
 "/examples/app-clipcut/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 64987,
  "sha256": "29af5f1381fab45ff4584ed61e5015e5ba05ad08baaa77274e1d438c56e6a0c5",
  "v": "29af5f13",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-clipcut/1/in-image.384.webp?v=7141e6f3"
 },
 "/examples/app-color-grading/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12164,
  "sha256": "e958bf540313e466b9ebebb8f21bdec026199b42876cf129dcba9809ec03782c",
  "v": "e958bf54",
  "w": 384,
  "h": 288
 },
 "/examples/app-color-grading/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 130293,
  "sha256": "f58469c6f60c32afa9eb416f66f4b22dc7f5dabfcf287f6f480b9eebda73e596",
  "v": "f58469c6",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-color-grading/1/in-image.384.webp?v=e958bf54"
 },
 "/examples/app-colorize/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12246,
  "sha256": "16c15f4c4f6c16b838af3eca5e22c100b5bbaec795335f80567bb8510d735c25",
  "v": "16c15f4c",
  "w": 384,
  "h": 288
 },
 "/examples/app-colorize/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126248,
  "sha256": "1a3e49167f55f5f436399343aff6a49814ad1a847e7517520fff83a046abb62c",
  "v": "1a3e4916",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-colorize/1/in-image.384.webp?v=16c15f4c"
 },
 "/examples/app-comic-book/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22852,
  "sha256": "580aeafa6ae94ad6e797ac7439945feec09d85759c039d3707f717c179b94956",
  "v": "580aeafa",
  "w": 384,
  "h": 288
 },
 "/examples/app-comic-book/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 162036,
  "sha256": "27e6f1a71e863b9362a89a264e5c1e591052c9d6267c0a44e38cbfb38e172bd1",
  "v": "27e6f1a7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-comic-book/1/in-image.384.webp?v=580aeafa"
 },
 "/examples/app-comic-book/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 49689,
  "sha256": "6c0a58e5389fb700ed749f5d2e36c8eadf9a9906ceefcafc8993b8baad9d3e2d",
  "v": "6c0a58e5",
  "w": 512,
  "h": 384
 },
 "/examples/app-commercial-faces/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12540,
  "sha256": "e28d43431a5356d0f3a69058e2483c35af90fff4479dde12b71adf8c5f65f5d7",
  "v": "e28d4343",
  "w": 384,
  "h": 288
 },
 "/examples/app-commercial-faces/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 118293,
  "sha256": "f0b09a5f0a0f87410dfaad4cfd2baee495a73b6ce853607ed0e7d04ee463dba9",
  "v": "f0b09a5f",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-commercial-faces/1/in-image.384.webp?v=e28d4343"
 },
 "/examples/app-dance/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25280,
  "sha256": "aa00d724876f0e4480697b408b88197f92253b9fa88f46e549400f49b7f853ff",
  "v": "aa00d724",
  "w": 384,
  "h": 288
 },
 "/examples/app-dance/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 178335,
  "sha256": "fbbc8b1a94fb0e487a62e0d80086b75106071f7e4ddb86578983a2f6c4cc6d7c",
  "v": "fbbc8b1a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-dance/1/in-image.384.webp?v=aa00d724"
 },
 "/examples/app-face-swap/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9558,
  "sha256": "e0db7c14ebc28948af6e6c9cd1c9ebc94a224ec5a8e83f49a3ea7effac862452",
  "v": "e0db7c14",
  "w": 384,
  "h": 288
 },
 "/examples/app-face-swap/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108895,
  "sha256": "c552c3fcdbce1ef532839e2d0646b79cdb76a4a925e58f2bb40c59de6554b0d1",
  "v": "c552c3fc",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-face-swap/1/in-image.384.webp?v=e0db7c14"
 },
 "/examples/app-face-swap/1/in-image2.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11206,
  "sha256": "ebf63769d03aca142686aa89581727efd619b07408be58c7a9da4d6f7297abb4",
  "v": "ebf63769",
  "w": 384,
  "h": 288
 },
 "/examples/app-face-swap/1/in-image2.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 124344,
  "sha256": "f88929cd38509a62a278550c11f88097742ba87353fcd054996d496bfa4e3fd8",
  "v": "f88929cd",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-face-swap/1/in-image2.384.webp?v=ebf63769"
 },
 "/examples/app-game-dump/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 26858,
  "sha256": "b2ce90502c51dd97e1274a0e1cafae7f1730b47ef328094e614c92234f052a1d",
  "v": "b2ce9050",
  "w": 384,
  "h": 288
 },
 "/examples/app-game-dump/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 187163,
  "sha256": "6d413ea3e6186466062d358a760bbbcd56f9a2ce51798e17da6c5d1bf9248de1",
  "v": "6d413ea3",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-game-dump/1/in-image.384.webp?v=b2ce9050"
 },
 "/examples/app-ghoulgao/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16522,
  "sha256": "3ca2639bff6ef6875e93b09dbfc5189d2a5480c00aa01560e32fdd121aa83679",
  "v": "3ca2639b",
  "w": 384,
  "h": 288
 },
 "/examples/app-ghoulgao/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111039,
  "sha256": "c1adeefa3e7015857164b1c07b9014c70c5bc3fe30f7fa4e9cb733577a683e6a",
  "v": "c1adeefa",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-ghoulgao/1/in-image.384.webp?v=3ca2639b"
 },
 "/examples/app-ghoulgao/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26703,
  "sha256": "f59578b42351e2d22bdeef4a89f019b1bfaeb823fa1831a0bb8de83fd4d8ef94",
  "v": "f59578b4",
  "w": 512,
  "h": 384
 },
 "/examples/app-giallo-horror/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15688,
  "sha256": "f9c3220d6e950bc28fb3598b3b174c009e3dcbb5ead7b0f87139b898d762e9d1",
  "v": "f9c3220d",
  "w": 384,
  "h": 288
 },
 "/examples/app-giallo-horror/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 119926,
  "sha256": "f7b6255258134a72c33761508d14f0c6e70e6c19f16a62375dda08bb8cdbc838",
  "v": "f7b62552",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-giallo-horror/1/in-image.384.webp?v=f9c3220d"
 },
 "/examples/app-giallo-horror/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 15694,
  "sha256": "c8a963f4c920b3d7c30249b4583612f1e00442737a339c5ac580c4221f1e8c1b",
  "v": "c8a963f4",
  "w": 512,
  "h": 384
 },
 "/examples/app-giant-product/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14814,
  "sha256": "9303f360356968324d91f00ef2ec5271d4a8b81024a9fc3d8da9b4956d55e3b3",
  "v": "9303f360",
  "w": 384,
  "h": 288
 },
 "/examples/app-giant-product/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 123868,
  "sha256": "34d00a3c69aee6cc1dcfecb8e81d120ea4955081dc2a838c4808f55c066fd367",
  "v": "34d00a3c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-giant-product/1/in-image.384.webp?v=9303f360"
 },
 "/examples/app-glitter-sticker/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22506,
  "sha256": "eeb7f21301a10b35ae29101777efd7b34a63140eb98886490de9feff3dc04367",
  "v": "eeb7f213",
  "w": 384,
  "h": 288
 },
 "/examples/app-glitter-sticker/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164166,
  "sha256": "e683b20309104dd5c42402c43d6a507e10a493fd4c977961da1b3705b7357dcd",
  "v": "e683b203",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-glitter-sticker/1/in-image.384.webp?v=eeb7f213"
 },
 "/examples/app-graffiti-ad/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 36822,
  "sha256": "c2fe464457c1680564cdd358efb584dd8b56aec3b272ab31b44722db97b414fc",
  "v": "c2fe4644",
  "w": 384,
  "h": 288
 },
 "/examples/app-graffiti-ad/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 249901,
  "sha256": "88ed292c04268fb21681440a9c48cee8efd443b31b30ee677ef8f43c0870f9d5",
  "v": "88ed292c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-graffiti-ad/1/in-image.384.webp?v=c2fe4644"
 },
 "/examples/app-graffiti-ad/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 56476,
  "sha256": "7740c8648785d2b31388f75a70ced7d8a30a1012a1f33c07adc03288a18357b6",
  "v": "7740c864",
  "w": 512,
  "h": 384
 },
 "/examples/app-hairstyle-try-on/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9940,
  "sha256": "0982c252f2b7fcc800ed11063fa900af9e3bff6fc28d466f40b293a01ef056c5",
  "v": "0982c252",
  "w": 384,
  "h": 288
 },
 "/examples/app-hairstyle-try-on/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 95808,
  "sha256": "8e5636c75a4c23148704768054ee5d3aba3f6f7a2a3409f99aa035530354b2ba",
  "v": "8e5636c7",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-hairstyle-try-on/1/in-image.384.webp?v=0982c252"
 },
 "/examples/app-headshot-generator/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15270,
  "sha256": "a5689fc07ebde3add8673c77dea01e05704d814cd98ac0f14c31de6caaa993cb",
  "v": "a5689fc0",
  "w": 384,
  "h": 288
 },
 "/examples/app-headshot-generator/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 127544,
  "sha256": "b2417e11ae6d21071983249d0b6c61588edc208c61ce290c438c0f1026b53f30",
  "v": "b2417e11",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-headshot-generator/1/in-image.384.webp?v=a5689fc0"
 },
 "/examples/app-hook-frame/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13414,
  "sha256": "f2a4d0e7c0c1a0cd888d60ee75fecdd7368cdad47bdaca56ae576adbea0c7336",
  "v": "f2a4d0e7",
  "w": 384,
  "h": 288
 },
 "/examples/app-hook-frame/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109470,
  "sha256": "efd65d2571f7b20c5930124db4d38e3b1fafb8c116c89a82b8e595d0a3eae372",
  "v": "efd65d25",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-hook-frame/1/in-image.384.webp?v=f2a4d0e7"
 },
 "/examples/app-hug/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22564,
  "sha256": "1d9631ed9ec00dd0ea869293e218cfef72a1ea78a3019a8ba7c6cd830aec6859",
  "v": "1d9631ed",
  "w": 384,
  "h": 288
 },
 "/examples/app-hug/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132258,
  "sha256": "052a0f08de9d10ba1c7db6adf383d2a0db0d11ec9eeb3ce001b49e6a5a0e3d08",
  "v": "052a0f08",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-hug/1/in-image.384.webp?v=1d9631ed"
 },
 "/examples/app-hug/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33257,
  "sha256": "3af2db8790b3f8957abbf932e7843f4ff345ed781c1a190b93f78d2c30df04b8",
  "v": "3af2db87",
  "w": 512,
  "h": 384
 },
 "/examples/app-j-poster/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19478,
  "sha256": "23899ac532c1776474dedd0f9da617d1b00b4ae257d4183804f43acdcbd3ec3a",
  "v": "23899ac5",
  "w": 384,
  "h": 288
 },
 "/examples/app-j-poster/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 144263,
  "sha256": "bc3559419d123c815715d53b85a28e94772e37be7651ab50639398655d1c7593",
  "v": "bc355941",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-j-poster/1/in-image.384.webp?v=23899ac5"
 },
 "/examples/app-j-poster/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36107,
  "sha256": "660611f88774a773052b8c603385558c76380fe238e1334af84efce3861e32a4",
  "v": "660611f8",
  "w": 512,
  "h": 384
 },
 "/examples/app-japanese-show/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13312,
  "sha256": "d011cd63583d6c6d4ef5bcac393c41bc566efe373bfb7fce8da3080d4e5e5a4f",
  "v": "d011cd63",
  "w": 384,
  "h": 288
 },
 "/examples/app-japanese-show/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 106096,
  "sha256": "1ed25494fcf53893c0357dfa300948a7a85ea7546efa9714aa90191224fbbe95",
  "v": "1ed25494",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-japanese-show/1/in-image.384.webp?v=d011cd63"
 },
 "/examples/app-latex/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4820,
  "sha256": "2e8635fa68bf80f9af97548cfa7b12e3771e57ae1a767d421e79426ccb9de81d",
  "v": "2e8635fa",
  "w": 384,
  "h": 288
 },
 "/examples/app-latex/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 54187,
  "sha256": "345333049a07d91310776dbc7c6247b1156222fe9afc94413cd335128f59cacd",
  "v": "34533304",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-latex/1/in-image.384.webp?v=2e8635fa"
 },
 "/examples/app-latex/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 9862,
  "sha256": "9d6520347598c2dcb0c5a0064c6d2cc740b3581e7717e544366380abc36b121c",
  "v": "9d652034",
  "w": 512,
  "h": 384
 },
 "/examples/app-macro-scene/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13576,
  "sha256": "9cff64314ad59bd7c759fe16ac515042785405ba30dcc9cda4b9c9283daf37d6",
  "v": "9cff6431",
  "w": 384,
  "h": 288
 },
 "/examples/app-macro-scene/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 92572,
  "sha256": "a10781f9042611eb89c88b1d51470153b1898c970d83ba3b0784b2fbf1d119d5",
  "v": "a10781f9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-macro-scene/1/in-image.384.webp?v=9cff6431"
 },
 "/examples/app-macro-scene/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31244,
  "sha256": "c361c848169b5a2ea1778325b278c633ae7c8c69d34e7426d707e5c31f5ea516",
  "v": "c361c848",
  "w": 512,
  "h": 384
 },
 "/examples/app-macroshot-product/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9962,
  "sha256": "cb853c146d4a4b9c1176dcfae0b09040b8de61b2e3566c6a9fbf80e96514654c",
  "v": "cb853c14",
  "w": 384,
  "h": 288
 },
 "/examples/app-macroshot-product/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 69332,
  "sha256": "bc1223a94e249ed322f8bc184b06c3b0b32c8772331862e1cab4f0c672490578",
  "v": "bc1223a9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-macroshot-product/1/in-image.384.webp?v=cb853c14"
 },
 "/examples/app-macroshot-product/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 17042,
  "sha256": "511c16e329e4e3cd233f60b5674c49e50a964d16219fed8c201281cca466e5cf",
  "v": "511c16e3",
  "w": 512,
  "h": 384
 },
 "/examples/app-magic-button/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22142,
  "sha256": "f268ac6d6ed7bbafeebd063fd9a966c479ca7940564dc8823fad4f32d3935a50",
  "v": "f268ac6d",
  "w": 384,
  "h": 288
 },
 "/examples/app-magic-button/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165395,
  "sha256": "46742b4ad0e102ab9907bc47efaa30fddac2f5934b95c072093a87f550b47e60",
  "v": "46742b4a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-magic-button/1/in-image.384.webp?v=f268ac6d"
 },
 "/examples/app-magic-button/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29389,
  "sha256": "962772167fec44595d4cfe926344f0e92cc57a510a049da497a7f08df332a257",
  "v": "96277216",
  "w": 512,
  "h": 384
 },
 "/examples/app-makeup-studio/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4624,
  "sha256": "587c2b3fff09583d3a86ebc1a0b7a519423fa584ca71745311b96b8f45717d75",
  "v": "587c2b3f",
  "w": 384,
  "h": 288
 },
 "/examples/app-makeup-studio/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 86748,
  "sha256": "49369bf0323e022d38c9754f29210f3a2679e97904763cd325586e39969743fa",
  "v": "49369bf0",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-makeup-studio/1/in-image.384.webp?v=587c2b3f"
 },
 "/examples/app-match-colors/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 29360,
  "sha256": "8d5ac75c3f71579679bfaf11074ea78fae50a95448d10461a78357d25e5a6621",
  "v": "8d5ac75c",
  "w": 384,
  "h": 288
 },
 "/examples/app-match-colors/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 280720,
  "sha256": "7dd6972d43159eb02c940341156d260b37a3c1a9bfde3cb4fa19387894953993",
  "v": "7dd6972d",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-match-colors/1/in-image.384.webp?v=8d5ac75c"
 },
 "/examples/app-match-colors/1/in-image2.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 31072,
  "sha256": "a54640d37d9faca7fb68ab679e1ab18f24e8c32c56b92e76bf4eb676dc9fb521",
  "v": "a54640d3",
  "w": 384,
  "h": 288
 },
 "/examples/app-match-colors/1/in-image2.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 286610,
  "sha256": "89cb1196b73c2fcf5833b7a5b7830d62f85664bdebf56699d7d67b530214d12b",
  "v": "89cb1196",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-match-colors/1/in-image2.384.webp?v=a54640d3"
 },
 "/examples/app-melting-doodle/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12422,
  "sha256": "a76b9c53301c3fa281db0309edf3ad092e8a6e4562df76599832ea07364d3066",
  "v": "a76b9c53",
  "w": 384,
  "h": 288
 },
 "/examples/app-melting-doodle/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 100517,
  "sha256": "7c435ea3051832015ce7e4c24279e3b2b5ada7c43e56c900d4e46baba82ca71c",
  "v": "7c435ea3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-melting-doodle/1/in-image.384.webp?v=a76b9c53"
 },
 "/examples/app-melting-doodle/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 60499,
  "sha256": "5cc13ff581a31940ef25f67e5ac96d57ec530c24a8a6391e0c070fce222a3e01",
  "v": "5cc13ff5",
  "w": 512,
  "h": 384
 },
 "/examples/app-meme-generator/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14082,
  "sha256": "c34b0b82dcf059b8f995a35046bfd1d07c58f448f24d728eb5242d15d40d2f56",
  "v": "c34b0b82",
  "w": 384,
  "h": 288
 },
 "/examples/app-meme-generator/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 106261,
  "sha256": "8a6ba1ccfbe4966abda68eb1af21a70973cd8983d40bc71e4cbef72d0bf15ce8",
  "v": "8a6ba1cc",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-meme-generator/1/in-image.384.webp?v=c34b0b82"
 },
 "/examples/app-micro-beasts/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 33002,
  "sha256": "dccc5d6cb4ffb48c9b353562c344e3ce8834ca543098cb78572aacfa5ab19fd4",
  "v": "dccc5d6c",
  "w": 384,
  "h": 288
 },
 "/examples/app-micro-beasts/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 266056,
  "sha256": "be1719c5449a270248169bf72d87c89b827366aa35dd5ecb4ffa7a5e34e36d15",
  "v": "be1719c5",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-micro-beasts/1/in-image.384.webp?v=dccc5d6c"
 },
 "/examples/app-mukbang/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21490,
  "sha256": "c60acf0764bf1758b42997ada1c0938eaa23e965d6db0fbed7c3a0d14be248be",
  "v": "c60acf07",
  "w": 384,
  "h": 288
 },
 "/examples/app-mukbang/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 136521,
  "sha256": "0f6ac5c169755e68a31823de336eb0dbe31fe080b420a4aa409e9d23dbb22537",
  "v": "0f6ac5c1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-mukbang/1/in-image.384.webp?v=c60acf07"
 },
 "/examples/app-mukbang/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37527,
  "sha256": "acaa3ce8cd68e77478a28b614c65fef02ab45f089c63b88fc3a8e32a8f4edacf",
  "v": "acaa3ce8",
  "w": 512,
  "h": 384
 },
 "/examples/app-object-remover/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17738,
  "sha256": "77bf52632a46dbd4e4144aed9aa5333418d4ca704152e17cf482c7d4697da6f4",
  "v": "77bf5263",
  "w": 384,
  "h": 288
 },
 "/examples/app-object-remover/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 143766,
  "sha256": "c6e2d1a1a18be41b9464006dfbf95908c7e596c11b23ef7f93f5e1d9790828bf",
  "v": "c6e2d1a1",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-object-remover/1/in-image.384.webp?v=77bf5263"
 },
 "/examples/app-outfit-shot/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12196,
  "sha256": "632f0e58800402468758a60c50e31ff0d5ad19a323db190159c77b3666cd43fa",
  "v": "632f0e58",
  "w": 384,
  "h": 288
 },
 "/examples/app-outfit-shot/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 147950,
  "sha256": "77ef94a93836d16252c8fbe7df0433632769a7dcb14a3c331892da95cc1dbb87",
  "v": "77ef94a9",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-outfit-shot/1/in-image.384.webp?v=632f0e58"
 },
 "/examples/app-outfit-vending/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13954,
  "sha256": "1028bef4c59fdaae5a26874389697d9df4912f184becef52055ced3f8626537e",
  "v": "1028bef4",
  "w": 384,
  "h": 288
 },
 "/examples/app-outfit-vending/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 154155,
  "sha256": "7d9535b17be31e370068850b694f60781ea62dd17d05aea6ab51c1e969bc2787",
  "v": "7d9535b1",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-outfit-vending/1/in-image.384.webp?v=1028bef4"
 },
 "/examples/app-packshot/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13062,
  "sha256": "2e77f5dbe3fe435d002643d03564d5757965f37884a46b226bb4d21720ca248a",
  "v": "2e77f5db",
  "w": 384,
  "h": 288
 },
 "/examples/app-packshot/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 117389,
  "sha256": "b0c9035d04d006d5533e5d6fffe4d3383d6eba30a5790544374c8c03d8209663",
  "v": "b0c9035d",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-packshot/1/in-image.384.webp?v=2e77f5db"
 },
 "/examples/app-paint-app/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22604,
  "sha256": "79dadc6e6d71a232f40dbb19f4d87e82ea7ed9a1df6d3e63ce705fd87e34f02c",
  "v": "79dadc6e",
  "w": 384,
  "h": 288
 },
 "/examples/app-paint-app/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 194825,
  "sha256": "79fe7b7b0d712eb9ce99e7da82f3dab7e1394f8420eff833c60d0b874dfc0ee6",
  "v": "79fe7b7b",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-paint-app/1/in-image.384.webp?v=79dadc6e"
 },
 "/examples/app-plushies/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22886,
  "sha256": "6f075cb261e1f745101f29b630e08ed1d8d6e78beaa6c2c5ab6634e4504c504e",
  "v": "6f075cb2",
  "w": 384,
  "h": 288
 },
 "/examples/app-plushies/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 159494,
  "sha256": "6a29aa5140f1b7cadae40b657c1eb6f517b160644f336861e66d5aa26486621b",
  "v": "6a29aa51",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-plushies/1/in-image.384.webp?v=6f075cb2"
 },
 "/examples/app-poster/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5276,
  "sha256": "230ed913e0e9e5dc3e115f66788a55083405dba95cc0bda7fd0192e91becc74f",
  "v": "230ed913",
  "w": 384,
  "h": 288
 },
 "/examples/app-poster/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 72913,
  "sha256": "75c7c6daf49dd2d86c31b833517a17cfdea6689a330f058e9b3476210e272c01",
  "v": "75c7c6da",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-poster/1/in-image.384.webp?v=230ed913"
 },
 "/examples/app-poster/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 20425,
  "sha256": "405f30f866b4cf0c3f233864a27078f038278771940846f900f176dfcd15fb8f",
  "v": "405f30f8",
  "w": 512,
  "h": 384
 },
 "/examples/app-product-360/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4194,
  "sha256": "58385be55018417dc8edd18cd9836c0eb2a8db0a71070565ef5a522d943b3eba",
  "v": "58385be5",
  "w": 384,
  "h": 288
 },
 "/examples/app-product-360/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 36760,
  "sha256": "1d43af17b8989d0c1f8a0cc2bc5d2b4938de657c30717a7f46b067c492bacb28",
  "v": "1d43af17",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-product-360/1/in-image.384.webp?v=58385be5"
 },
 "/examples/app-product-shot/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 2204,
  "sha256": "1322fe3a644e93e7950748e3b34feb93c1729b0b0b7429da51467307177f5f20",
  "v": "1322fe3a",
  "w": 384,
  "h": 288
 },
 "/examples/app-product-shot/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 28907,
  "sha256": "fccbfc130347cc622f3236174f12a271c86e0f5c84fbb49d29b5309a4266f948",
  "v": "fccbfc13",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-product-shot/1/in-image.384.webp?v=1322fe3a"
 },
 "/examples/app-rap-god/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7112,
  "sha256": "c1c73969971b41250ed4c5278f46c3ba21f8b3670376c02b372e62553e50fd23",
  "v": "c1c73969",
  "w": 384,
  "h": 288
 },
 "/examples/app-rap-god/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 67250,
  "sha256": "3baa7b430dce9d5318e3dcb68c4bc976148046327cbd7810d84875d1ffff9395",
  "v": "3baa7b43",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-rap-god/1/in-image.384.webp?v=c1c73969"
 },
 "/examples/app-relight/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10572,
  "sha256": "f232d98df18085a92ce5d62c1827f15bca7851960a9a16a49d98579b1616aaec",
  "v": "f232d98d",
  "w": 384,
  "h": 288
 },
 "/examples/app-relight/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 104296,
  "sha256": "b43cf666ffee2b1d829ddfd7979461b837ff967b95d8211a187bbea61a4bcc96",
  "v": "b43cf666",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-relight/1/in-image.384.webp?v=f232d98d"
 },
 "/examples/app-remove-background/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12230,
  "sha256": "4d778e69ef2c35d35ac191bb6fce05ec1e953d96dce44f04f1d12edaffa2eedc",
  "v": "4d778e69",
  "w": 384,
  "h": 288
 },
 "/examples/app-remove-background/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 101071,
  "sha256": "7bc0f96b781e33b6449bcf14a831a350a95abdbb12e9e7307047c5b76a888536",
  "v": "7bc0f96b",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-remove-background/1/in-image.384.webp?v=4d778e69"
 },
 "/examples/app-renaissance/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9136,
  "sha256": "c67e5110221aa19f76968c5fdb96643fcd96c77ee0129fe19cf31d9d1c774eba",
  "v": "c67e5110",
  "w": 384,
  "h": 288
 },
 "/examples/app-renaissance/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83912,
  "sha256": "f6dbb9c6a3c424f5cf54cb7ff04ed819305212823e49a10b536d9f8797a01b51",
  "v": "f6dbb9c6",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-renaissance/1/in-image.384.webp?v=c67e5110"
 },
 "/examples/app-renaissance/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21540,
  "sha256": "c2eb2234fe4eaeaffdd4319cdd158f438f4d870ca3c1ce4d6ddefad25aa6b91a",
  "v": "c2eb2234",
  "w": 512,
  "h": 384
 },
 "/examples/app-restore-photo/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17056,
  "sha256": "b6ac319b007f1b217c77316d3787ec61d5bcd7bbdd3de959483f3537d198e07b",
  "v": "b6ac319b",
  "w": 384,
  "h": 288
 },
 "/examples/app-restore-photo/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165454,
  "sha256": "27594964bfbaa179fac22e6eb733f50d765d34ae298bd9f7e5daf7b90045a454",
  "v": "27594964",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-restore-photo/1/in-image.384.webp?v=b6ac319b"
 },
 "/examples/app-roller-coaster/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17034,
  "sha256": "e788bea32394a82b23cde280dcc4648ff236a359e3496710ead8f513bd0a64b0",
  "v": "e788bea3",
  "w": 384,
  "h": 288
 },
 "/examples/app-roller-coaster/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 122165,
  "sha256": "5e4cd8c491e8b1a17e6f59b8a5808031b9c4f62211579b26ff94ad80e6458d4a",
  "v": "5e4cd8c4",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-roller-coaster/1/in-image.384.webp?v=e788bea3"
 },
 "/examples/app-roller-coaster/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 34246,
  "sha256": "2d11413985eacdfdde1053f130b342c5304eef4b32c0a70cd15d9456caa2d3f5",
  "v": "2d114139",
  "w": 512,
  "h": 384
 },
 "/examples/app-sand-worm/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13242,
  "sha256": "055f6cfadf86dba6dc4807646b8acc09bc646aad2ac0897068dae3d2b79601d9",
  "v": "055f6cfa",
  "w": 384,
  "h": 288
 },
 "/examples/app-sand-worm/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 99102,
  "sha256": "e0a1059e5a240886449c3e736e0a0caf881c6d4340c5160aa170516eddfe33b7",
  "v": "e0a1059e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-sand-worm/1/in-image.384.webp?v=055f6cfa"
 },
 "/examples/app-sand-worm/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27140,
  "sha256": "58c58d60dca69ee7a108e160a207426d74d9db408d4d114de5f5d35be94cdb6e",
  "v": "58c58d60",
  "w": 512,
  "h": 384
 },
 "/examples/app-similarity-score/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7968,
  "sha256": "12e028ac0ed8079ea0e04bc08dabaeaaec42771f8d43341a162ac2ec105dd419",
  "v": "12e028ac",
  "w": 384,
  "h": 288
 },
 "/examples/app-similarity-score/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 77358,
  "sha256": "ef045e7171ed236bee97eef5d6a1b081597942d8bfcaa53bf5ffd0d048bff9d5",
  "v": "ef045e71",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-similarity-score/1/in-image.384.webp?v=12e028ac"
 },
 "/examples/app-simlife/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14490,
  "sha256": "99518d827fd182c5a044b0a949923d5a807072e5984dfc00431cbe217a5575fa",
  "v": "99518d82",
  "w": 384,
  "h": 288
 },
 "/examples/app-simlife/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 117654,
  "sha256": "cbdc5611681518813fede10f37ad11340a289d14e8a95bebaca498386d4d1dca",
  "v": "cbdc5611",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-simlife/1/in-image.384.webp?v=99518d82"
 },
 "/examples/app-simlife/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 9086,
  "sha256": "ba29cb2c7d71f92fbcff4c3fb11c238aed43cbed1df413a96e22c2d2b1157009",
  "v": "ba29cb2c",
  "w": 512,
  "h": 384
 },
 "/examples/app-sketch-to-real/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13192,
  "sha256": "84d8066a16d65e9bc04da539dbea2ec73b038e7ae37bec972ea03581d263f730",
  "v": "84d8066a",
  "w": 384,
  "h": 288
 },
 "/examples/app-sketch-to-real/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 194978,
  "sha256": "edb2a657709acedba7edc41cd970eeabde314f62e933e8eb243cee07f5bfe372",
  "v": "edb2a657",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-sketch-to-real/1/in-image.384.webp?v=84d8066a"
 },
 "/examples/app-skin-enhancer/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5882,
  "sha256": "eee94d429ca7aa5a2e2ae30a42b1a268c9a40a030055618a45493458bbcec7a2",
  "v": "eee94d42",
  "w": 384,
  "h": 288
 },
 "/examples/app-skin-enhancer/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 70599,
  "sha256": "99d112f86a9cd810ecb7632d7aa226ca86a873a3620f9cfffcad15c6bcf2ccd2",
  "v": "99d112f8",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-skin-enhancer/1/in-image.384.webp?v=eee94d42"
 },
 "/examples/app-sticker-match-cut/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12876,
  "sha256": "8e09c7a833c8c3295992c747163f97625b883ce9c8c7962bc833a622fbefe9fb",
  "v": "8e09c7a8",
  "w": 384,
  "h": 288
 },
 "/examples/app-sticker-match-cut/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109699,
  "sha256": "432ccad41e9563c875ae5b141217d0e62db742c3ac8ab84f5a41c6bd4c8fd1e5",
  "v": "432ccad4",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-sticker-match-cut/1/in-image.384.webp?v=8e09c7a8"
 },
 "/examples/app-sticker-pack/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16808,
  "sha256": "d2823cf026fb68e305317e09c29f5c7a608edb9ef667ec83fb30530a544a2e13",
  "v": "d2823cf0",
  "w": 384,
  "h": 288
 },
 "/examples/app-sticker-pack/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 129094,
  "sha256": "f5c0f4323322dde0754ab9cf4790ac1f5095630bac7639b8b7babe9ec66cef1a",
  "v": "f5c0f432",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-sticker-pack/1/in-image.384.webp?v=d2823cf0"
 },
 "/examples/app-storm-creature/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11718,
  "sha256": "f2195daf3d3923e1bdd7a3ee6243259e03d53f4e960fbfdbfc70cde26d8340e0",
  "v": "f2195daf",
  "w": 384,
  "h": 288
 },
 "/examples/app-storm-creature/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83490,
  "sha256": "cd1c930c5962c5d9d43837e1f16ee83d23d49deef2f0ac40fa2d51b82f2c47b8",
  "v": "cd1c930c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-storm-creature/1/in-image.384.webp?v=f2195daf"
 },
 "/examples/app-style-snap/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12872,
  "sha256": "e42f25fb5da65d8387465ef11548beb5e62c0161105c6dfb02b5c3bae73ba3e9",
  "v": "e42f25fb",
  "w": 384,
  "h": 288
 },
 "/examples/app-style-snap/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 117409,
  "sha256": "fbbe0191a4b9f7e7da965559a8bea97716cf2b2ed46cb9a1c8f29d2a94b5129c",
  "v": "fbbe0191",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-style-snap/1/in-image.384.webp?v=e42f25fb"
 },
 "/examples/app-style-transfer/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19458,
  "sha256": "b4f8ff00ee1c6023fb4625e74599eb084bc9fc6dd9d4f670a9eea07e5969a237",
  "v": "b4f8ff00",
  "w": 384,
  "h": 288
 },
 "/examples/app-style-transfer/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 172129,
  "sha256": "0907ceb4f3be4e0b9b233c47f2037ea8bbf807033df336bf15b4d590055d1a15",
  "v": "0907ceb4",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-style-transfer/1/in-image.384.webp?v=b4f8ff00"
 },
 "/examples/app-text-edit/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21432,
  "sha256": "4aa5da5c9440142f86370e6f143704cd2748714af242aac028199e8dc97d3673",
  "v": "4aa5da5c",
  "w": 384,
  "h": 288
 },
 "/examples/app-text-edit/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 196955,
  "sha256": "46c71ba1d078908c145eae29d8fdce56925fb34506804b6e6c0ba4bf08cc99e9",
  "v": "46c71ba1",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-text-edit/1/in-image.384.webp?v=4aa5da5c"
 },
 "/examples/app-truck-ad/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19654,
  "sha256": "b5a0cf88b4eeed26c2f5112395eb8a12058e73f56a36b5ea67de2c69e58d967e",
  "v": "b5a0cf88",
  "w": 384,
  "h": 288
 },
 "/examples/app-truck-ad/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 145620,
  "sha256": "67feb719673fe3bf38143d7628fab0fe76e9f148d5aa246344208d0597257d35",
  "v": "67feb719",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-truck-ad/1/in-image.384.webp?v=b5a0cf88"
 },
 "/examples/app-truck-ad/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31806,
  "sha256": "e1661cd506b1d6c6fbeab61cdeb300c100cc1f22a9c162114985439431308ba2",
  "v": "e1661cd5",
  "w": 512,
  "h": 384
 },
 "/examples/app-upscale/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12608,
  "sha256": "b9be4a627b17588337acb850efa23774516b9fe04e5c37473a5294fab1d06246",
  "v": "b9be4a62",
  "w": 320,
  "h": 240
 },
 "/examples/app-upscale/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 12972,
  "sha256": "0767abbf6d77c58e06d6b408c38a073b4f0cc38830bee02f6ddfae1f0b77c6ea",
  "v": "0767abbf",
  "w": 320,
  "h": 240,
  "thumb": "/examples/app-upscale/1/in-image.384.webp?v=b9be4a62"
 },
 "/examples/app-urban-cuts/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17580,
  "sha256": "307ad1b87821b244c51aa19a01cf38434feb7a3dc7c04d5be1a3693d32dd391d",
  "v": "307ad1b8",
  "w": 384,
  "h": 288
 },
 "/examples/app-urban-cuts/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111777,
  "sha256": "3a27296ad356a663116bdb701b9c6fc1f4ace09d5ca73f2c3da2c9d8b16c9e3f",
  "v": "3a27296a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-urban-cuts/1/in-image.384.webp?v=307ad1b8"
 },
 "/examples/app-vectorize/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 6616,
  "sha256": "3f4193c3f87fe42d54e0e18d67ad5f2c0355122b7ef4ebcc1d28eabdb52a6260",
  "v": "3f4193c3",
  "w": 384,
  "h": 288
 },
 "/examples/app-vectorize/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 135049,
  "sha256": "de990e23b6dd1f0214bad2d5616aa9619aa41869be222ded0adf9e13730a386f",
  "v": "de990e23",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/app-vectorize/1/in-image.384.webp?v=3f4193c3"
 },
 "/examples/app-victory-card/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11864,
  "sha256": "1023ced90f46a63f1e5c6b88f934b15ece51f333e7c1f7ac205f4a050bbb7bf9",
  "v": "1023ced9",
  "w": 384,
  "h": 288
 },
 "/examples/app-victory-card/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85479,
  "sha256": "2b8304b864b13426bc1545410db6da000be3177a5a74506e425a75ed7b431aeb",
  "v": "2b8304b8",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-victory-card/1/in-image.384.webp?v=1023ced9"
 },
 "/examples/app-victory-card/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 41162,
  "sha256": "6d833fd5d583485bde919748d8c9f467ff6f4b9373703783864c13d8eec2923c",
  "v": "6d833fd5",
  "w": 512,
  "h": 384
 },
 "/examples/app-yes-kiss/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20494,
  "sha256": "7330bccee37efff3bb27bbc6f4b19af7398ef161ed6d157357d7dfcb3c581025",
  "v": "7330bcce",
  "w": 384,
  "h": 288
 },
 "/examples/app-yes-kiss/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 130131,
  "sha256": "a58db65b7b8fc4dce9dc4d43543f5a898a7eea187c7cb9007101babea48ec021",
  "v": "a58db65b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/app-yes-kiss/1/in-image.384.webp?v=7330bcce"
 },
 "/examples/app-yes-kiss/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 35413,
  "sha256": "72f18f45c37c539735f2db0fe4a2e27bbf16c93e30436904f87ec7b7b99e2878",
  "v": "72f18f45",
  "w": 512,
  "h": 384
 },
 "/examples/effect-acid/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14778,
  "sha256": "53f9b1617084c4df372d87e370c9c2be5e3956609c18a4978aae9b92f03cdb13",
  "v": "53f9b161",
  "w": 384,
  "h": 288
 },
 "/examples/effect-acid/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109744,
  "sha256": "59d5ed5d5b7d0d5e1ad4b045f4869756b3f2d198af596ed875adfc682e504058",
  "v": "59d5ed5d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-acid/1/in-image.384.webp?v=53f9b161"
 },
 "/examples/effect-act-natural/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24522,
  "sha256": "55db55a90f0a8c89978833b311b031a1ec231ab80821935c01e276c3a36f9b03",
  "v": "55db55a9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-act-natural/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 156188,
  "sha256": "e1fcfa5fbe84f56e2fb9f6e8a457ffd7c3d91d872ab0f333694625df61909b7d",
  "v": "e1fcfa5f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-act-natural/1/in-image.384.webp?v=55db55a9"
 },
 "/examples/effect-act-natural/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 40572,
  "sha256": "65df483dac03fb8dd8b5a99b9324b9a81962fc9daae23fe7e3e0d154fd69f212",
  "v": "65df483d",
  "w": 512,
  "h": 384
 },
 "/examples/effect-agamemnon/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17178,
  "sha256": "156a44129d12195a1a5c6461460172594e5f9ca74fdedab05baf842cf3769963",
  "v": "156a4412",
  "w": 384,
  "h": 288
 },
 "/examples/effect-agamemnon/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 124525,
  "sha256": "5a85f22161fcc1f4c801e3ec8817d03d0a8bfeffbf33d08f95abdaa16f310ec2",
  "v": "5a85f221",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-agamemnon/1/in-image.384.webp?v=156a4412"
 },
 "/examples/effect-agent-reveal/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12450,
  "sha256": "e1ecd8db6c23f1b31028e86f58e383cf38d57bcbf28b5fd05274edeaf4386d9b",
  "v": "e1ecd8db",
  "w": 384,
  "h": 288
 },
 "/examples/effect-agent-reveal/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 99136,
  "sha256": "3eff498d5b231db851d8fc407ced63b522a04ff8e05e07b30844b0a306be54bf",
  "v": "3eff498d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-agent-reveal/1/in-image.384.webp?v=e1ecd8db"
 },
 "/examples/effect-agent-reveal/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22599,
  "sha256": "2bca643a0eef8bfd504e81d58d88bc8539b580cca49757dcfc5963a4422ec7c4",
  "v": "2bca643a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-akrill/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22176,
  "sha256": "5930a33a0605483537bbb2ac599ef92627b48d533f4d2b3457e717b617a77426",
  "v": "5930a33a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-akrill/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 143192,
  "sha256": "6f24adf13d1d397868787294ce7a970800f87e4e0b8874045dc391fc83fc35d0",
  "v": "6f24adf1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-akrill/1/in-image.384.webp?v=5930a33a"
 },
 "/examples/effect-angel-wings/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8396,
  "sha256": "38704e894d48f88fe227b4efd0528cecb1ca44bbaaa29befc8aa13a86c0c2e7a",
  "v": "38704e89",
  "w": 384,
  "h": 288
 },
 "/examples/effect-angel-wings/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 69199,
  "sha256": "2318f9a1076b0d6b92286de94b42f20e267037272f4cfaa9c974540e7e453ed2",
  "v": "2318f9a1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-angel-wings/1/in-image.384.webp?v=38704e89"
 },
 "/examples/effect-angry-mode/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10964,
  "sha256": "663403a73f69c801c5235029f93d730f88ed2de502971d56d29faf7fdf284b6f",
  "v": "663403a7",
  "w": 384,
  "h": 288
 },
 "/examples/effect-angry-mode/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83591,
  "sha256": "9ecd6ca9778f48089e2dffb1e72f0022ebb0745229bbaee561bd08f7c0eb053d",
  "v": "9ecd6ca9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-angry-mode/1/in-image.384.webp?v=663403a7"
 },
 "/examples/effect-angry-mode/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22145,
  "sha256": "c8c0262a21948dc9286f9303cf9add49824d5c82d8f6d8118455e5c077c606c8",
  "v": "c8c0262a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-aquarium/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24496,
  "sha256": "e8326c3186e41aad21b8f669623b04ae2ceb04e949da9c7fc8a12dd33ea2babd",
  "v": "e8326c31",
  "w": 384,
  "h": 288
 },
 "/examples/effect-aquarium/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164161,
  "sha256": "9dac6f9a746ddba8670428cc4f445b22e15985ed4027a9b33b062c24e827964b",
  "v": "9dac6f9a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-aquarium/1/in-image.384.webp?v=e8326c31"
 },
 "/examples/effect-atomic/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9814,
  "sha256": "bd5ef85160a804cffc67590a1afa5a580027a33367bc3512e0366abd287b564d",
  "v": "bd5ef851",
  "w": 384,
  "h": 288
 },
 "/examples/effect-atomic/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 86536,
  "sha256": "652287babb8b6c372831d3bc02d6f06a84fbf8f0740ba9dbdf084467124731ed",
  "v": "652287ba",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-atomic/1/in-image.384.webp?v=bd5ef851"
 },
 "/examples/effect-attack-of-clones/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13578,
  "sha256": "32c6f61a51ed1216ec8c78b9071d9697d3118dcca6e26dcbfa2a99b9cbceb5e5",
  "v": "32c6f61a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-attack-of-clones/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 119614,
  "sha256": "d75934cb68825d49840056d5b5d549756e3ea249931a6f6470cd6a309b81be71",
  "v": "d75934cb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-attack-of-clones/1/in-image.384.webp?v=32c6f61a"
 },
 "/examples/effect-ballet/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15432,
  "sha256": "ad585206d9905403dde9ed69e527dee106c90eff23d48206ef7fe71e2fdcd729",
  "v": "ad585206",
  "w": 384,
  "h": 288
 },
 "/examples/effect-ballet/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126082,
  "sha256": "2a0d796e53bc94da7cf6fe126b11af9589446390d233453fe6dfd96a918d8573",
  "v": "2a0d796e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-ballet/1/in-image.384.webp?v=ad585206"
 },
 "/examples/effect-balloon/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 2658,
  "sha256": "969a2939ad7923c1a34c7aaff8532bc0e6fadc0cf2033e1a7ae23ecf8050a612",
  "v": "969a2939",
  "w": 384,
  "h": 288
 },
 "/examples/effect-balloon/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 28036,
  "sha256": "596ec4158a37c36f620717addffc2525a47838feec79079ccfd46696637ac393",
  "v": "596ec415",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-balloon/1/in-image.384.webp?v=969a2939"
 },
 "/examples/effect-beach-ride/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14398,
  "sha256": "15309cf012a5c03af78a0fa22ec304df60ea2d53b2f5750cf30b743ed76937dc",
  "v": "15309cf0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-beach-ride/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111945,
  "sha256": "7229abe92bf69a6ee13eab4f8c8abdf4f1392781fd1c5e1552e5ca6063071c52",
  "v": "7229abe9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-beach-ride/1/in-image.384.webp?v=15309cf0"
 },
 "/examples/effect-beach-ride/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25635,
  "sha256": "0e5fa6514e0bac48703ba81d573353a9ac0152eb447314002d2f8e456a7adfaa",
  "v": "0e5fa651",
  "w": 512,
  "h": 384
 },
 "/examples/effect-beast-appearance/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17112,
  "sha256": "e549d655792aa1811df3c6d4cee58a8e38bd759fdf8f175d85349915b2778f41",
  "v": "e549d655",
  "w": 384,
  "h": 288
 },
 "/examples/effect-beast-appearance/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 128526,
  "sha256": "5ebc174d31d031e0a6df276964a7e2e50dc8e6564c06a000b1bd0e46ef53dc08",
  "v": "5ebc174d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-beast-appearance/1/in-image.384.webp?v=e549d655"
 },
 "/examples/effect-beast-appearance/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29904,
  "sha256": "4dead3c827329e6601b791d11b32a46acaed795a7479df3deb28875cfd56fa4f",
  "v": "4dead3c8",
  "w": 512,
  "h": 384
 },
 "/examples/effect-black-gloss/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9220,
  "sha256": "56a68c26c5ed9cd099c535bdfffa7c896048a8fd2ee667b3194c61e7c80fd401",
  "v": "56a68c26",
  "w": 384,
  "h": 288
 },
 "/examples/effect-black-gloss/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 95886,
  "sha256": "014eceb8d12c987b3f17011dee7f98e8ad0ee059eda71c713cbd2ce58fb84f7f",
  "v": "014eceb8",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-black-gloss/1/in-image.384.webp?v=56a68c26"
 },
 "/examples/effect-black-tears/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10504,
  "sha256": "23c293c9c70bab6b6b638310797a1deeae1ddbb05526988dd0730affaa95c0c8",
  "v": "23c293c9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-black-tears/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85694,
  "sha256": "ec3e768528bf4367f0c63fb34a77b043e9c31a9deb1d205baf4e2cf081d87242",
  "v": "ec3e7685",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-black-tears/1/in-image.384.webp?v=23c293c9"
 },
 "/examples/effect-bleach-bypass/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15284,
  "sha256": "199517349eb586e3b48e8b49606c2ce115996c7653c389b955e24336bf307e22",
  "v": "19951734",
  "w": 384,
  "h": 288
 },
 "/examples/effect-bleach-bypass/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 118377,
  "sha256": "1a3c091bd5099d2040d3f539632f070602e8ddf0f9872ad307d505538ab6c86d",
  "v": "1a3c091b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-bleach-bypass/1/in-image.384.webp?v=19951734"
 },
 "/examples/effect-bleached-warm/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12558,
  "sha256": "0134a5c8eccbd447755a9a24e1f03abdda8b9578c464abd8dae36b6002bb284a",
  "v": "0134a5c8",
  "w": 384,
  "h": 288
 },
 "/examples/effect-bleached-warm/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109464,
  "sha256": "62ce4cde20df24128a98c603af399e3da3f622c31c81d321080ffc64c6443f56",
  "v": "62ce4cde",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-bleached-warm/1/in-image.384.webp?v=0134a5c8"
 },
 "/examples/effect-blue-depth/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18102,
  "sha256": "1d92fa071d61a0341e009dce4e1f1f319d22ee36b5a18399b8e4b67ee52d0cda",
  "v": "1d92fa07",
  "w": 384,
  "h": 288
 },
 "/examples/effect-blue-depth/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 122381,
  "sha256": "8e680ff61818eeb48841f19f4c7bce28dfaa7b2c8c802f57515a8f91549b9bef",
  "v": "8e680ff6",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-blue-depth/1/in-image.384.webp?v=1d92fa07"
 },
 "/examples/effect-boiling-point/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10282,
  "sha256": "554a98d14e6f7b52c4e10b82d4b13ccf1d5c760fb8dfd8818d020abe7ac91a0c",
  "v": "554a98d1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-boiling-point/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85907,
  "sha256": "3ad6b67f33b45c2129882ddacf9b43a78b7a677ee1e2caba87a53d1ba759a8a2",
  "v": "3ad6b67f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-boiling-point/1/in-image.384.webp?v=554a98d1"
 },
 "/examples/effect-boiling-point/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22143,
  "sha256": "0fa6ad85098aa8622666fd2a5328e7de5b0563fbfaa4eab530a2181d38304e71",
  "v": "0fa6ad85",
  "w": 512,
  "h": 384
 },
 "/examples/effect-bubbles/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18872,
  "sha256": "d3335bb08f7dd2543483eab3939651cbf2d03e5d6e0d22a33e33feb9446b237b",
  "v": "d3335bb0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-bubbles/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 121371,
  "sha256": "38cf1c9f39dba4f1faeffa37679fdb1c66512d509191fec40ac9bb421fe0b530",
  "v": "38cf1c9f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-bubbles/1/in-image.384.webp?v=d3335bb0"
 },
 "/examples/effect-buddy/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 28520,
  "sha256": "04f2ff89eecbfa72066bd30bb9c7a3277e60445f0996e4af27e36c3bc1ed0ea0",
  "v": "04f2ff89",
  "w": 384,
  "h": 288
 },
 "/examples/effect-buddy/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 172149,
  "sha256": "53d12e7a197a597f2b7a061ae805d3ade3184c0df27b4de669cf08bb414f5647",
  "v": "53d12e7a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-buddy/1/in-image.384.webp?v=04f2ff89"
 },
 "/examples/effect-buddy/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 44047,
  "sha256": "45dd909ecdc5fa52f29b6a382887cfe81f78e629dee1d74b3eaa49032c5de651",
  "v": "45dd909e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-building-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10144,
  "sha256": "c52563a13a0b2fc0c1bc847abd2896d88bc55f01762db80edc9cf4937d2453ba",
  "v": "c52563a1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-building-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 88401,
  "sha256": "88860500a9eb5ca2df509bb11934793bc1c7557c751d13bb6cc495c80510b576",
  "v": "88860500",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-building-explosion/1/in-image.384.webp?v=c52563a1"
 },
 "/examples/effect-cakeify/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8356,
  "sha256": "5358e4b23dea2565bcf8a1e4e4ece1631916c74cf16666e14482684c19dd5f15",
  "v": "5358e4b2",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cakeify/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 69756,
  "sha256": "214c572269465d535039e03c73108b0fc00074d53a997005b95bc15dda0fa1ad",
  "v": "214c5722",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cakeify/1/in-image.384.webp?v=5358e4b2"
 },
 "/examples/effect-cakeify/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22436,
  "sha256": "978458db8f31890b77d0d460f3a81c1b16e3d3aa18dbea56543342f887385aca",
  "v": "978458db",
  "w": 512,
  "h": 384
 },
 "/examples/effect-candy-pink/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9886,
  "sha256": "54cb1704d793ec0806ae057629d7e39855760de85ff05eda85d6a601eabfa3ef",
  "v": "54cb1704",
  "w": 384,
  "h": 288
 },
 "/examples/effect-candy-pink/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 82801,
  "sha256": "86d24b9f97717c7b67c4d1df288ee3c3523194bcdf62271f2a259e05eb344225",
  "v": "86d24b9f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-candy-pink/1/in-image.384.webp?v=54cb1704"
 },
 "/examples/effect-cannabis/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 35488,
  "sha256": "1712b1458d99bdb08eda413f74947b72121e4d3dc21f8a655c3e81c8d4555403",
  "v": "1712b145",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cannabis/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 210774,
  "sha256": "48dbebbef115d8394e530d7902e71845aaea97ea87dd8471ff82c856c577f111",
  "v": "48dbebbe",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cannabis/1/in-image.384.webp?v=1712b145"
 },
 "/examples/effect-canvas/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21846,
  "sha256": "f26bc5d909210e7569b79543e326affa0ea3591903827af87c7fab19b5a623d5",
  "v": "f26bc5d9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-canvas/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 143321,
  "sha256": "8f93cda2b1409cfbe7d61a04952811f52710bb0dbc6acfa7bc70e1d857d34874",
  "v": "8f93cda2",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-canvas/1/in-image.384.webp?v=f26bc5d9"
 },
 "/examples/effect-car-drive/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16326,
  "sha256": "ea06a272e8712ac915dad66343101893d2d0e16857ea8d0513799c0b433815b2",
  "v": "ea06a272",
  "w": 384,
  "h": 288
 },
 "/examples/effect-car-drive/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109981,
  "sha256": "e31d60e7f190c9bc5d0de457b2a37c144903c864831392402c048127c81d8fe4",
  "v": "e31d60e7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-car-drive/1/in-image.384.webp?v=ea06a272"
 },
 "/examples/effect-car-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22908,
  "sha256": "1fb165609464199935484f5ea354d1815025cffc7f8d648e259ad34a1e07d153",
  "v": "1fb16560",
  "w": 384,
  "h": 288
 },
 "/examples/effect-car-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 155726,
  "sha256": "66006403e559319601b51a99b7a34a7ad3174705dc4a9b87e380a2e8c5b02aa8",
  "v": "66006403",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-car-explosion/1/in-image.384.webp?v=1fb16560"
 },
 "/examples/effect-censorship/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22222,
  "sha256": "5e5e92fba1617c59ea5031577da42c8a59c7b7e812f16cb5e71cea7b64ff9150",
  "v": "5e5e92fb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-censorship/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 152337,
  "sha256": "7d5f0401b190351d05fe9669ae4c21f2f39fe4f99143f5971b5bdb839d52472f",
  "v": "7d5f0401",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-censorship/1/in-image.384.webp?v=5e5e92fb"
 },
 "/examples/effect-censorship/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36120,
  "sha256": "bf57485374e92d0f7cadbdbe8527c43695a785d465e5199982b0cdb9d875738c",
  "v": "bf574853",
  "w": 512,
  "h": 384
 },
 "/examples/effect-classic-bw/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23248,
  "sha256": "978c7f822c89d234d4b8248614844ea7162c73d18d0549bf3e7e13cce2be6cac",
  "v": "978c7f82",
  "w": 384,
  "h": 288
 },
 "/examples/effect-classic-bw/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 152468,
  "sha256": "e3a4b6a7494f46e2132907fcac2e0d7a0d764449da06050d4aa3c0c0024bdd15",
  "v": "e3a4b6a7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-classic-bw/1/in-image.384.webp?v=978c7f82"
 },
 "/examples/effect-clone-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4704,
  "sha256": "7ced2ddbeca1e45aee287b0f1fd7a2f634cde8dee1bf30ae34c71012ac11d837",
  "v": "7ced2ddb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-clone-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 53463,
  "sha256": "13d147ea22820368d6d9e75045f72814949058a3a52080803e4910543bf82aa0",
  "v": "13d147ea",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-clone-explosion/1/in-image.384.webp?v=7ced2ddb"
 },
 "/examples/effect-clones/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 6688,
  "sha256": "9df4badb155d44f8507557ae2cbd9384395267ddebaddad5dc57b82f12c47d06",
  "v": "9df4badb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-clones/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 65516,
  "sha256": "b9235e905b02479ebccb13623163e7d50aa07687b870aef8e8fadfe1f88b3f4d",
  "v": "b9235e90",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-clones/1/in-image.384.webp?v=9df4badb"
 },
 "/examples/effect-clones/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21688,
  "sha256": "eb2113bbd55d762e2fcf01759e692b58957e84f290d0b3f81f5934867c85668a",
  "v": "eb2113bb",
  "w": 512,
  "h": 384
 },
 "/examples/effect-clothes-rain/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23518,
  "sha256": "4ee57633f5ed32319c7ba4b0af298a6267da5ebae1487012193068db431b899d",
  "v": "4ee57633",
  "w": 384,
  "h": 288
 },
 "/examples/effect-clothes-rain/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 169790,
  "sha256": "a53f7f710a13ad378571dd4fa4bb5572520587f3fdf5d851a3356215892c2711",
  "v": "a53f7f71",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-clothes-rain/1/in-image.384.webp?v=4ee57633"
 },
 "/examples/effect-cold-steel/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19964,
  "sha256": "edc8c71a8ef4273b60511557b509c5b3f4cd06d95194a861df7c09a4a26b5036",
  "v": "edc8c71a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cold-steel/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 143507,
  "sha256": "76d1f7cc5c892660aff009b16633a9608d9a897387871ab83abcc0caa21755b4",
  "v": "76d1f7cc",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cold-steel/1/in-image.384.webp?v=edc8c71a"
 },
 "/examples/effect-cold-vision/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 29072,
  "sha256": "e3e30e45994db88afd9f73852ed257817d458464157dda940257f50c564d7a54",
  "v": "e3e30e45",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cold-vision/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 168069,
  "sha256": "eeeda0451f538c3c7d795c3e170aeb1ae65060af21d008267e3860d3c0c6e0e5",
  "v": "eeeda045",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cold-vision/1/in-image.384.webp?v=e3e30e45"
 },
 "/examples/effect-color-rain/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14904,
  "sha256": "14578099a53b73fe701938053d4005db902e497a4331cbe9dc3027f364ea383a",
  "v": "14578099",
  "w": 384,
  "h": 288
 },
 "/examples/effect-color-rain/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 106677,
  "sha256": "afacc2824db24550a83db570578cf1668d5f99978dbf7c5305dec23afbf780eb",
  "v": "afacc282",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-color-rain/1/in-image.384.webp?v=14578099"
 },
 "/examples/effect-color-rain/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38405,
  "sha256": "07bf859eb8418dc0e8085195b3fc8e619b1afb83cee65cf83d24e8e30c1a5df2",
  "v": "07bf859e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-column-wipe/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9346,
  "sha256": "cd1f5b990faf6e6ddb32c9bb375e584ece71dd88df4ab294a52600e5397809b6",
  "v": "cd1f5b99",
  "w": 384,
  "h": 288
 },
 "/examples/effect-column-wipe/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 87285,
  "sha256": "276be20e7e851f1fe20b380c690d01efb35250b81304ec0933853fe981c0dfe5",
  "v": "276be20e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-column-wipe/1/in-end-image.384.webp?v=cd1f5b99"
 },
 "/examples/effect-column-wipe/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10172,
  "sha256": "cbc822c75d52e8f56570e099c985b11400c1344cfe7a461165c7969f7c827429",
  "v": "cbc822c7",
  "w": 384,
  "h": 288
 },
 "/examples/effect-column-wipe/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 88909,
  "sha256": "f314ade031786356eea3996daa8b5ee9b239f742183155fb581b6018e44df7ed",
  "v": "f314ade0",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-column-wipe/1/in-image.384.webp?v=cbc822c7"
 },
 "/examples/effect-column-wipe/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21131,
  "sha256": "b6ea1d9cd512b2a26fb703fc6424ff39b802d6f9383b1eba92201555882005fc",
  "v": "b6ea1d9c",
  "w": 512,
  "h": 384
 },
 "/examples/effect-comic/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18178,
  "sha256": "354d1f06b33f759239da2081a4a5d6dbc719da8e434a1ca3d8aad174250fddb1",
  "v": "354d1f06",
  "w": 384,
  "h": 288
 },
 "/examples/effect-comic/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 128056,
  "sha256": "4c79c4552925fc37b6da551d7d64f71d945d0a6847a8c08aafa1a0971a8eab72",
  "v": "4c79c455",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-comic/1/in-image.384.webp?v=354d1f06"
 },
 "/examples/effect-contre-jour/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20074,
  "sha256": "cb430319c8bd8964e086ba7d1941d1aadebaa6d2c2af3deb30a4d6fa109bd584",
  "v": "cb430319",
  "w": 384,
  "h": 288
 },
 "/examples/effect-contre-jour/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 127807,
  "sha256": "b6c9a5852ebf8a5203ae278e977256c50615f5cec5a115f9c81c821d033396c8",
  "v": "b6c9a585",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-contre-jour/1/in-image.384.webp?v=cb430319"
 },
 "/examples/effect-cotton-cloud/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11540,
  "sha256": "6baa81a023b69f8c444d4e3ce8dfb8c448367ae7a3574ed0af1b4540de0beeca",
  "v": "6baa81a0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cotton-cloud/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 99416,
  "sha256": "6865515be6d6e4032f7ab035a1481a57d58be617b00417f009294e9fa2b44fbd",
  "v": "6865515b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cotton-cloud/1/in-image.384.webp?v=6baa81a0"
 },
 "/examples/effect-crimson-vigil/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10412,
  "sha256": "d126b0b2dfa953a364653db43435129c5f297a30a47c700870611c394fb15386",
  "v": "d126b0b2",
  "w": 384,
  "h": 288
 },
 "/examples/effect-crimson-vigil/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 97047,
  "sha256": "c4eee30d4cf8fab54e31041c8877acfa91257b2f3b9c2568f3025f1bb6fc02da",
  "v": "c4eee30d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-crimson-vigil/1/in-image.384.webp?v=d126b0b2"
 },
 "/examples/effect-crush/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13204,
  "sha256": "fe9fa1c39156637efe947222b8fa73ab8ea857f0f4471c2adc554b503531c765",
  "v": "fe9fa1c3",
  "w": 384,
  "h": 288
 },
 "/examples/effect-crush/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 110343,
  "sha256": "083c2d5cf65c31231170ba17715ea12cff9db24e11bae44cf18a34ba0eff247e",
  "v": "083c2d5c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-crush/1/in-image.384.webp?v=fe9fa1c3"
 },
 "/examples/effect-crush/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 23250,
  "sha256": "ba986e384e49ae914fb5b2505d676a3906bfe3094ac621917e8b3f35892e5e19",
  "v": "ba986e38",
  "w": 512,
  "h": 384
 },
 "/examples/effect-crying/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13526,
  "sha256": "d77ff477272e83b7cf82ed081194c6d207b5fd8ef74d5e93cfe3626ffb63aa4b",
  "v": "d77ff477",
  "w": 384,
  "h": 288
 },
 "/examples/effect-crying/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108930,
  "sha256": "300e02ae8ef62edcbf717d3f28c78881ce16ae2002e3b0ca7e7fb38a39da8541",
  "v": "300e02ae",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-crying/1/in-image.384.webp?v=d77ff477"
 },
 "/examples/effect-crying/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24772,
  "sha256": "04e4baa7ac8d198748291265efd82fa49ad1c9e19f581ba065029fbbf79021d5",
  "v": "04e4baa7",
  "w": 512,
  "h": 384
 },
 "/examples/effect-cyborg/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8716,
  "sha256": "080f87c9053324195b2d8cb726e1b149cc4329324cefb6488971707eba9d3407",
  "v": "080f87c9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cyborg/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 70628,
  "sha256": "f6880ccb9c8a687a08d91d7fbc477b1c38630302cebf5678aadaab27f6446994",
  "v": "f6880ccb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cyborg/1/in-image.384.webp?v=080f87c9"
 },
 "/examples/effect-cyclope/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 6734,
  "sha256": "941f72dcabffd9b7375bba68d02f36059cc8f7c91a5c6736b9ac82994723494a",
  "v": "941f72dc",
  "w": 384,
  "h": 288
 },
 "/examples/effect-cyclope/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 65698,
  "sha256": "56ff6884d2da7abacf6f4cc6931afc3948cfe5ea9e606b40d7fc40713e8bba0b",
  "v": "56ff6884",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-cyclope/1/in-image.384.webp?v=941f72dc"
 },
 "/examples/effect-cyclope/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 15020,
  "sha256": "c9d3ca9eb27179ad1307e3dd773cb4724e210f4c6d2d7b70b3c3011464949664",
  "v": "c9d3ca9e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-datamosh/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 33840,
  "sha256": "f884195ddcec116236a70b6a3d67cebf8f9977fd56acc61e462c8588cbf6b151",
  "v": "f884195d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-datamosh/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 220970,
  "sha256": "7548256dc95da965f9c55e69834a1ea492744b193277b8af2498fecfc491dc87",
  "v": "7548256d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-datamosh/1/in-image.384.webp?v=f884195d"
 },
 "/examples/effect-datamosh/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 54123,
  "sha256": "e1b0610233bcf7d299f030cb3bef25121177cd8465d581649c3654ef70229ece",
  "v": "e1b06102",
  "w": 512,
  "h": 384
 },
 "/examples/effect-deflate/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 26052,
  "sha256": "4d6580b0ab6acf8b7fa0fcd6ba18664520d546ccfde49e8b02606e5035684bd9",
  "v": "4d6580b0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-deflate/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 185811,
  "sha256": "5cc6393667479388f2ba639f59ba0d360a1890051425aa8d8393786f1875b788",
  "v": "5cc63936",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-deflate/1/in-image.384.webp?v=4d6580b0"
 },
 "/examples/effect-deflate/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37816,
  "sha256": "44b98babe9bf7bb35bc76ffdcf172f5b5928c8f16be5381f541a17217d93035d",
  "v": "44b98bab",
  "w": 512,
  "h": 384
 },
 "/examples/effect-diamond/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 3446,
  "sha256": "92dfd8c267f2db5624d032427df7dd63eeea4b6a272ddbd4a8ebac8ebfb18b58",
  "v": "92dfd8c2",
  "w": 384,
  "h": 288
 },
 "/examples/effect-diamond/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 38098,
  "sha256": "1eb87c78ceb190775e38c6a9106eee2e3c9881e41adceca19c97866040955766",
  "v": "1eb87c78",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-diamond/1/in-image.384.webp?v=92dfd8c2"
 },
 "/examples/effect-dirty-lens/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14480,
  "sha256": "4ce380d5bec1308b26c6efad3d6919f63aa9ab138954370579b8b0e855d786d6",
  "v": "4ce380d5",
  "w": 384,
  "h": 288
 },
 "/examples/effect-dirty-lens/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 97052,
  "sha256": "52818b01e626e10a2700e427f3e4acf0161b04c841ffb9434aaa637e378947a8",
  "v": "52818b01",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-dirty-lens/1/in-image.384.webp?v=4ce380d5"
 },
 "/examples/effect-display-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18934,
  "sha256": "4a3a2e616160ea039dc39a0070c3d53d036fd48e0b674c7e437f1bf5184dc031",
  "v": "4a3a2e61",
  "w": 384,
  "h": 288
 },
 "/examples/effect-display-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 140782,
  "sha256": "c04217898b9a4a09a7b6fb1910157541958daaa8e5e38f635410d99a7a1ea312",
  "v": "c0421789",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-display-transition/1/in-end-image.384.webp?v=4a3a2e61"
 },
 "/examples/effect-display-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7874,
  "sha256": "f391dacf29035277770c0f86f9c1d22a7093ba8e55dfa0dd123ecdeaff1960c8",
  "v": "f391dacf",
  "w": 384,
  "h": 288
 },
 "/examples/effect-display-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 79689,
  "sha256": "e90030392afc508d557aff9fb32c0ca667bb63a5573532002e34ddd14ff4b29d",
  "v": "e9003039",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-display-transition/1/in-image.384.webp?v=f391dacf"
 },
 "/examples/effect-display-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24274,
  "sha256": "c35e7ad1c0cdca042f980b50583f61f8dc57b57618716432b66f49fade3db140",
  "v": "c35e7ad1",
  "w": 512,
  "h": 384
 },
 "/examples/effect-dolphin-ride/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12606,
  "sha256": "0c620af26062448511727653523bfa15500698f5b473c6ed5356f05004dbc090",
  "v": "0c620af2",
  "w": 384,
  "h": 288
 },
 "/examples/effect-dolphin-ride/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 97610,
  "sha256": "71202245fe14420706c7c38fe64773990f1350c50cc6f8139b038bbaeac378cb",
  "v": "71202245",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-dolphin-ride/1/in-image.384.webp?v=0c620af2"
 },
 "/examples/effect-dream-date/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12596,
  "sha256": "1bfb70860a5c459294467d5a3a0a646a63637326b8f1bae68a2f6815a08be5aa",
  "v": "1bfb7086",
  "w": 384,
  "h": 288
 },
 "/examples/effect-dream-date/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91430,
  "sha256": "4e3452eb921442eaa8e20f2470654b641bfb394e17aaa89ce3146f08cfd5367f",
  "v": "4e3452eb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-dream-date/1/in-image.384.webp?v=1bfb7086"
 },
 "/examples/effect-dream-date/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 28546,
  "sha256": "6ff19002b5625970740b8ad2b5203e48b912414fcbcda0f44b3d4f3f42a39822",
  "v": "6ff19002",
  "w": 512,
  "h": 384
 },
 "/examples/effect-drunk-master/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27736,
  "sha256": "704dfa1e7323173be22545b09177549822f0a16dd9d3f52346040e2164a1517b",
  "v": "704dfa1e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-drunk-master/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 179517,
  "sha256": "aa1833529957b9aba462a87265d3c8fe237e4947028adfd0a95ec459843faf96",
  "v": "aa183352",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-drunk-master/1/in-image.384.webp?v=704dfa1e"
 },
 "/examples/effect-drunk-master/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 45162,
  "sha256": "9846310a007f77852854979a61204f4e8a2e8139e3d27b9cce11bd119340512c",
  "v": "9846310a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-duplicate/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19862,
  "sha256": "638f0b0fe2908fc1fa5990ab8a7d6b24a6ffc683417e979e07b8af21adc7a95c",
  "v": "638f0b0f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-duplicate/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 145184,
  "sha256": "262a386f9520714b5a837e42d227e8c50abbb56cd21567bbee35b909a6426ee1",
  "v": "262a386f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-duplicate/1/in-image.384.webp?v=638f0b0f"
 },
 "/examples/effect-earth-element/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22486,
  "sha256": "d5c8c0a2a58f797606ada30ed622a6fcfbaa40eeaa1bbab3ed10959fd3054a19",
  "v": "d5c8c0a2",
  "w": 384,
  "h": 288
 },
 "/examples/effect-earth-element/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 154057,
  "sha256": "f912e82d26cabdc33562c4ac4cc25b93352253e98b0cb3e6d0f89ae116c0e616",
  "v": "f912e82d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-earth-element/1/in-image.384.webp?v=d5c8c0a2"
 },
 "/examples/effect-earth-element/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38090,
  "sha256": "35aeec7eb69924870e9f07201dcb07848138791b0efe004244cd858ab7fc44ba",
  "v": "35aeec7e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-earth-zoom-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 37142,
  "sha256": "ebb172dd2969a53600b882e5a13a6caf394a061e3eafc12885e0ef5be9de7062",
  "v": "ebb172dd",
  "w": 384,
  "h": 288
 },
 "/examples/effect-earth-zoom-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 248670,
  "sha256": "ea5b1a3e80facd546d411a2378bd2caa279b7d862df12184f7c89405ae03c5bd",
  "v": "ea5b1a3e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-earth-zoom-out/1/in-image.384.webp?v=ebb172dd"
 },
 "/examples/effect-earth-zoom-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 19639,
  "sha256": "16efe52c8fd884adb3327bcf9c61bdf5496e2540cc186914ad05e0d5209f8850",
  "v": "16efe52c",
  "w": 512,
  "h": 384
 },
 "/examples/effect-eating/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13536,
  "sha256": "d63c09292464f4ee31d71af67cb9632034e8ac333d9bf59509297d16bf1137de",
  "v": "d63c0929",
  "w": 384,
  "h": 288
 },
 "/examples/effect-eating/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 95793,
  "sha256": "98bc520688f8cac114750e7701b808155537ee9c8d8dec93bd5c31554e9291c1",
  "v": "98bc5206",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-eating/1/in-image.384.webp?v=d63c0929"
 },
 "/examples/effect-eating/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25051,
  "sha256": "5a7115dd1595a18cf37f1ad9a0975434cc8f22b6070ad24b9952fdbfe4c63677",
  "v": "5a7115dd",
  "w": 512,
  "h": 384
 },
 "/examples/effect-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22978,
  "sha256": "9b29e3532bcc0021e45728dd27def336fed857105fed1731e2dc6c4742085f4c",
  "v": "9b29e353",
  "w": 384,
  "h": 288
 },
 "/examples/effect-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 158768,
  "sha256": "1ce7b5ebc9e053b7839ac86f458c68fc967ba2339b70dffc6010bfd08a63d642",
  "v": "1ce7b5eb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-explosion/1/in-image.384.webp?v=9b29e353"
 },
 "/examples/effect-fairies-around/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 31962,
  "sha256": "83952501c207f3070000286a3630877171cfa837505148808c306f6123e6b244",
  "v": "83952501",
  "w": 384,
  "h": 288
 },
 "/examples/effect-fairies-around/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 175799,
  "sha256": "6a27b326bc2773bf662929f66421120db9b2609f4e3195dd340b4bdee552fbd6",
  "v": "6a27b326",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-fairies-around/1/in-image.384.webp?v=83952501"
 },
 "/examples/effect-fairytale-castle/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10290,
  "sha256": "77238f1c1c0d70306376668f4102f143751608fb0e4d69f5df01bfac8ec5404d",
  "v": "77238f1c",
  "w": 384,
  "h": 288
 },
 "/examples/effect-fairytale-castle/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 87178,
  "sha256": "66ffa2fc372a18e76c50784f415b59a0e7e979e8741dcd1a8614a13ed2e48a56",
  "v": "66ffa2fc",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-fairytale-castle/1/in-image.384.webp?v=77238f1c"
 },
 "/examples/effect-film-colors/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8454,
  "sha256": "7bab22c9d6d68bad79af47adc1aabfd4a72d0e11f3cb763d3c0189fcd972d7f7",
  "v": "7bab22c9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-film-colors/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 81789,
  "sha256": "daa002f55bf99583870268298f2f1d6ae7eee2c8623236db008ddf09349d3bb8",
  "v": "daa002f5",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-film-colors/1/in-image.384.webp?v=7bab22c9"
 },
 "/examples/effect-fire-breath/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10148,
  "sha256": "b41060da57afbb9105c5ab0f4246707441c67367358f75b8dce009193dbe1248",
  "v": "b41060da",
  "w": 384,
  "h": 288
 },
 "/examples/effect-fire-breath/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85394,
  "sha256": "5b4e5c4add1e31f30a4c3a6d289bfdc977db5c1bc5b6090131f82f7a8e2b22d3",
  "v": "5b4e5c4a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-fire-breath/1/in-image.384.webp?v=b41060da"
 },
 "/examples/effect-fire-element/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20302,
  "sha256": "17b28ee0e1e6e6f45e4fcd8cfeb8b8f94313b27aeefd5fb2fe4164234aab162b",
  "v": "17b28ee0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-fire-element/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 148555,
  "sha256": "150059ef2162a513e9b4e4d9483b8b4bde3b8ab036fb181d1e3d3dc09b37e44e",
  "v": "150059ef",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-fire-element/1/in-image.384.webp?v=17b28ee0"
 },
 "/examples/effect-firelava/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10428,
  "sha256": "de3de7267a6c36764aacf498d272352f5e5b1b437acbf8d4d5186727881b6d54",
  "v": "de3de726",
  "w": 384,
  "h": 288
 },
 "/examples/effect-firelava/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 86174,
  "sha256": "5490546ef0810841779459f15ec794dfe090d74523bcce413fdfa58426ccf737",
  "v": "5490546e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-firelava/1/in-image.384.webp?v=de3de726"
 },
 "/examples/effect-firelava/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25063,
  "sha256": "e3371b11aa4628a78d59378b81a5dce581b87118e822072cefd8c44c1fc3f8fd",
  "v": "e3371b11",
  "w": 512,
  "h": 384
 },
 "/examples/effect-firework/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9726,
  "sha256": "482cdaaec06c933dc1295d470bfe4ac34ba1825018a3bc21151cb7ea6d818e1e",
  "v": "482cdaae",
  "w": 384,
  "h": 288
 },
 "/examples/effect-firework/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 82056,
  "sha256": "669416ee94c0a60b2380d1710be7048e50467c98fdf89caa85dc492d01a432c6",
  "v": "669416ee",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-firework/1/in-image.384.webp?v=482cdaae"
 },
 "/examples/effect-firework/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 44406,
  "sha256": "f4d4594198089d9a494962599cd56beed7922abe4e258e6aaaab4d8577ae8175",
  "v": "f4d45941",
  "w": 512,
  "h": 384
 },
 "/examples/effect-flame-on/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14234,
  "sha256": "9c01cf85bdac540c0314d51838cc12ffffed91a6e630355afef96875d5e21f84",
  "v": "9c01cf85",
  "w": 384,
  "h": 288
 },
 "/examples/effect-flame-on/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 107464,
  "sha256": "8fb25e59988f3c8b9280d08866954385b42a4f2d2f12973ba066b6556ab4be19",
  "v": "8fb25e59",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-flame-on/1/in-image.384.webp?v=9c01cf85"
 },
 "/examples/effect-flame-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13018,
  "sha256": "f658bb397844a993f05d93c13c3baf0d04dd4c1d0429138308d5dc697c999987",
  "v": "f658bb39",
  "w": 384,
  "h": 288
 },
 "/examples/effect-flame-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91385,
  "sha256": "b1f9035c20790506754befe13dc73d13f0c93655a4dfcfd06ecd058db63e5534",
  "v": "b1f9035c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-flame-transition/1/in-end-image.384.webp?v=f658bb39"
 },
 "/examples/effect-flame-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20548,
  "sha256": "760fc856c501dcf3466ae1d71b43099c02b89a6ad34f3b9935084ab56c0ec179",
  "v": "760fc856",
  "w": 384,
  "h": 288
 },
 "/examples/effect-flame-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 131459,
  "sha256": "7308fd36128aec23a1dbe0e9abbf59d6cbd72f4728c6f6c8c8f859ebd79964d7",
  "v": "7308fd36",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-flame-transition/1/in-image.384.webp?v=760fc856"
 },
 "/examples/effect-flame-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 32336,
  "sha256": "da1b074b14f1a0df417c95c1676ee2345d0aeaba0e9d5b5b975e5751647e1699",
  "v": "da1b074b",
  "w": 512,
  "h": 384
 },
 "/examples/effect-floating-fish/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21604,
  "sha256": "548664750c1086188e482c6c41c1bd24f16e7db4246793dca0fbbc070c93eed2",
  "v": "54866475",
  "w": 384,
  "h": 288
 },
 "/examples/effect-floating-fish/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 139873,
  "sha256": "9cbf341245af379f07eb3b307b6c90a44b59ada350c58fc5fb6322d216b3ebec",
  "v": "9cbf3412",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-floating-fish/1/in-image.384.webp?v=54866475"
 },
 "/examples/effect-floating-fish/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36277,
  "sha256": "4ba67412ed71f33fd39cba079e284dc1ce2cc3cf470bf3288e92cd7326b21e06",
  "v": "4ba67412",
  "w": 512,
  "h": 384
 },
 "/examples/effect-flood/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22742,
  "sha256": "2e4ec2df1f6a68033a8955f581b1f1acb2821e4c2f91e8866693411c0a26517a",
  "v": "2e4ec2df",
  "w": 384,
  "h": 288
 },
 "/examples/effect-flood/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 162753,
  "sha256": "3a7cd32229262a71b39ef7428e3e34e0d9a5bd7c0c266f9d74cda8cfcd15693b",
  "v": "3a7cd322",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-flood/1/in-image.384.webp?v=2e4ec2df"
 },
 "/examples/effect-floral-eyes/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13948,
  "sha256": "ac38484316896e83121cce4b709486021094e93a81d8c2b075fc649540edaca9",
  "v": "ac384843",
  "w": 384,
  "h": 288
 },
 "/examples/effect-floral-eyes/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 101807,
  "sha256": "4fafec5861f94861f0843c9d73fddb764eb0a15f70b9aee80f6e649789ae67ac",
  "v": "4fafec58",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-floral-eyes/1/in-image.384.webp?v=ac384843"
 },
 "/examples/effect-fragments/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17454,
  "sha256": "58ecc5bd1c64881a7273c309251d9e8fe9f39f8990cd53cdc4ef4c56bb439067",
  "v": "58ecc5bd",
  "w": 384,
  "h": 288
 },
 "/examples/effect-fragments/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 116614,
  "sha256": "466e4197f16ec563b6ed5c9c37bd0d12ec8c7ec0e2c3891519cd8e7deec458b7",
  "v": "466e4197",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-fragments/1/in-image.384.webp?v=58ecc5bd"
 },
 "/examples/effect-freezing/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27080,
  "sha256": "7c94028f2df0c14b10b063826dff70ba88b4f1e38b26dcb4e99087d8b13c14e1",
  "v": "7c94028f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-freezing/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 170733,
  "sha256": "6aaa0ca8890a84719a1473afe0a6155c6299961631f3156a98f6bc85f3d52e85",
  "v": "6aaa0ca8",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-freezing/1/in-image.384.webp?v=7c94028f"
 },
 "/examples/effect-garden-bloom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9746,
  "sha256": "9d3ad40257e801e8fa9dabba3ca3a4869f24d6c89d06296d866aeaec2678cc7e",
  "v": "9d3ad402",
  "w": 384,
  "h": 288
 },
 "/examples/effect-garden-bloom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 90104,
  "sha256": "936f2dfdf423322390f475e8e8c477f4974f036eacbb0eded0bae495c813d6f8",
  "v": "936f2dfd",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-garden-bloom/1/in-image.384.webp?v=9d3ad402"
 },
 "/examples/effect-garden-bloom/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27297,
  "sha256": "1fe79b0fbf7600aa5ed29a9318c5da6508c1e989fcec4873d6c7da6102009d50",
  "v": "1fe79b0f",
  "w": 512,
  "h": 384
 },
 "/examples/effect-gas-transformation/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9456,
  "sha256": "85aa02b4ea98215414c38f9fe166679d393fe05fd9e88b8cec692f32b65e016a",
  "v": "85aa02b4",
  "w": 384,
  "h": 288
 },
 "/examples/effect-gas-transformation/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 81955,
  "sha256": "1ad048631572a2fe13211b34091a7b5e055ad909b3859db5b063de4a49cd96fb",
  "v": "1ad04863",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-gas-transformation/1/in-image.384.webp?v=85aa02b4"
 },
 "/examples/effect-gas-transformation/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21236,
  "sha256": "b5bb0692415c41d9ea667d64b79198988e160d961eef503b67c605941f0ce03a",
  "v": "b5bb0692",
  "w": 512,
  "h": 384
 },
 "/examples/effect-giant-grab/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14524,
  "sha256": "d5770b12069e38112f146b5f5293b2caaaa791971c35c028e0e55da1cc87bf57",
  "v": "d5770b12",
  "w": 384,
  "h": 288
 },
 "/examples/effect-giant-grab/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 103625,
  "sha256": "85ff7433b607e48b0de46bdede09eb2a969de250ffa3f17519255c85d67c86a7",
  "v": "85ff7433",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-giant-grab/1/in-image.384.webp?v=d5770b12"
 },
 "/examples/effect-giant-grab/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26447,
  "sha256": "039d87f26e6fe55b0db7cc685c08c32fae6dfa2e086ea03834038dae78c6b02d",
  "v": "039d87f2",
  "w": 512,
  "h": 384
 },
 "/examples/effect-glitch/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9656,
  "sha256": "97c9bb2ace7bf2e0da09430e8fa67a5fbfb1f69c940de45318c4b6b36da748f0",
  "v": "97c9bb2a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-glitch/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 100826,
  "sha256": "ea20e4c3c185de592c842b384a2966cd1d63a5a19683e32b2ab3091c0e11d521",
  "v": "ea20e4c3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-glitch/1/in-image.384.webp?v=97c9bb2a"
 },
 "/examples/effect-glitch/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 28421,
  "sha256": "0f43a33b1f339edb29bbd2aa253ebd267edd8a1f5d7cdb83dea4740b47bde6a8",
  "v": "0f43a33b",
  "w": 512,
  "h": 384
 },
 "/examples/effect-glow-trace/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5514,
  "sha256": "45f23ceb5c36a6bba86fce5d3ad368c7aecf5de9cb30359b61d1c2150bc85261",
  "v": "45f23ceb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-glow-trace/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 57955,
  "sha256": "9206594f6870384a4cc0bb3c76ba0175a33129bf892194d1cfc66d513756b489",
  "v": "9206594f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-glow-trace/1/in-image.384.webp?v=45f23ceb"
 },
 "/examples/effect-glow-trace/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 14609,
  "sha256": "8a23d90f1caa4931321aca69a289c6a76695c2eae5f9e0dceeeafb1582a81be7",
  "v": "8a23d90f",
  "w": 512,
  "h": 384
 },
 "/examples/effect-glowshift/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 36014,
  "sha256": "b14882828f4e0b83da12d2e872d76c9a0e063d7ecf4dded3cf4b79f1de8659e0",
  "v": "b1488282",
  "w": 384,
  "h": 288
 },
 "/examples/effect-glowshift/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 192510,
  "sha256": "e293c41c47c5a42e2f3ab53f3a84fb8b381faacb1d4fe24e20cb3fab275f93b6",
  "v": "e293c41c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-glowshift/1/in-image.384.webp?v=b1488282"
 },
 "/examples/effect-glowshift/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 53343,
  "sha256": "71c622c15f958ad5670d0e83495333fb46d6074bf23734547b0825b5af1b7b7b",
  "v": "71c622c1",
  "w": 512,
  "h": 384
 },
 "/examples/effect-group-photo/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15862,
  "sha256": "4a5b8c3e2e51de2ae15d2af458ffd02839036c46e95d35ebf64efb42f44608fc",
  "v": "4a5b8c3e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-group-photo/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 110951,
  "sha256": "0a09bd66b61d9924bf21025363cb835f8cfaa242d62006c5aeb98451d04eb7ec",
  "v": "0a09bd66",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-group-photo/1/in-image.384.webp?v=4a5b8c3e"
 },
 "/examples/effect-group-photo/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27570,
  "sha256": "b3746bacdd9f31396839053db3cc80a5e26bed06832514da184f7daf55370a19",
  "v": "b3746bac",
  "w": 512,
  "h": 384
 },
 "/examples/effect-hand-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19358,
  "sha256": "6b1d22c37bad36ef36b43a43a93c2d874278f6bf0bebc53e76b24ffd50262ae4",
  "v": "6b1d22c3",
  "w": 384,
  "h": 288
 },
 "/examples/effect-hand-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 116438,
  "sha256": "34b925f27b00c3b42cd55c52baa9e4a585e842dfde23ee63e201c24b977fe5ce",
  "v": "34b925f2",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-hand-transition/1/in-end-image.384.webp?v=6b1d22c3"
 },
 "/examples/effect-hand-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15614,
  "sha256": "23dd4cb0571bb9c0d6a5b6359313ed80cb3cacf14165bc3e458a2bb69d7e6d46",
  "v": "23dd4cb0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-hand-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108211,
  "sha256": "ba64baffb05ba85ec63ef1ec88535edd637308b3d343407578e29fd0e7f899c3",
  "v": "ba64baff",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-hand-transition/1/in-image.384.webp?v=23dd4cb0"
 },
 "/examples/effect-hand-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31763,
  "sha256": "9e1771411c2a5e5caaddc1a7a00c52e36e7e0b1e7dba233d3b5b2c570c6eb7c0",
  "v": "9e177141",
  "w": 512,
  "h": 384
 },
 "/examples/effect-handheld-run/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17238,
  "sha256": "cc3c51eda3faeb95645bbd403e9dd623122254b0f77c9996bc4737ad0a2b6704",
  "v": "cc3c51ed",
  "w": 384,
  "h": 288
 },
 "/examples/effect-handheld-run/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114321,
  "sha256": "714443923e32aad9e54b5e9f43411f5eb1ffd59903fd4bd941d939f27cb500b5",
  "v": "71444392",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-handheld-run/1/in-image.384.webp?v=cc3c51ed"
 },
 "/examples/effect-handheld-run/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37498,
  "sha256": "2d8a4d83892e59ab0a5047bebe26f043b1ef48b5acd0ed9e3e7b278f48fd7f35",
  "v": "2d8a4d83",
  "w": 512,
  "h": 384
 },
 "/examples/effect-happy-mode/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20518,
  "sha256": "fa899ce8639cb0fe12aa653db3c8757b07157699907472858433730dad810b6e",
  "v": "fa899ce8",
  "w": 384,
  "h": 288
 },
 "/examples/effect-happy-mode/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 129919,
  "sha256": "2e2a434a395859ce03b95aa757438cf5baaf8c5eb12d3815ccc55341d87d0128",
  "v": "2e2a434a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-happy-mode/1/in-image.384.webp?v=fa899ce8"
 },
 "/examples/effect-happy-mode/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36154,
  "sha256": "39beaa11a886d9e45e01ce98c4bdbcd5844536bc26fcce058164d532aa85f98d",
  "v": "39beaa11",
  "w": 512,
  "h": 384
 },
 "/examples/effect-happy/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24612,
  "sha256": "dcebb9bc8d21b5288668e05a5a06ad922a759930ca1244f4918a5499c9a5e6a9",
  "v": "dcebb9bc",
  "w": 384,
  "h": 288
 },
 "/examples/effect-happy/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 151607,
  "sha256": "e50f5aea01e986a4e741f9b8241421c6265730f690d2b5655674a2abe7c56cf7",
  "v": "e50f5aea",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-happy/1/in-image.384.webp?v=dcebb9bc"
 },
 "/examples/effect-happy/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 40526,
  "sha256": "e0a4a7bc17a0818aaa48cd006f78229aa3723731d2fed112359d5073d2c94bce",
  "v": "e0a4a7bc",
  "w": 512,
  "h": 384
 },
 "/examples/effect-head-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5704,
  "sha256": "d08b481039ca20b0842f539cc3bab4aed6d5d65d88742b83a886524300f579ad",
  "v": "d08b4810",
  "w": 384,
  "h": 288
 },
 "/examples/effect-head-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 81591,
  "sha256": "ebb1e7ca18add1e4bb3811fa2ede0fa3c9de8ddd69c244804f9fcd3460f1595c",
  "v": "ebb1e7ca",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-head-explosion/1/in-image.384.webp?v=d08b4810"
 },
 "/examples/effect-head-explosion/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 17867,
  "sha256": "b6b30773cdb358a3c639770cb9078492aba21ab08970881feda168ee68c7a98a",
  "v": "b6b30773",
  "w": 512,
  "h": 384
 },
 "/examples/effect-head-off/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14270,
  "sha256": "11e97973859855446037b4b4aca23a002c57abca34d28ddee3b04614ddc56d43",
  "v": "11e97973",
  "w": 384,
  "h": 288
 },
 "/examples/effect-head-off/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114367,
  "sha256": "1fc00d8f8261d2094aefc0e521bcf28c846eb7a897915590ea75fbc746c69245",
  "v": "1fc00d8f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-head-off/1/in-image.384.webp?v=11e97973"
 },
 "/examples/effect-head-off/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29087,
  "sha256": "4b788b5e8a4a327789e939e7d07c0628a407e6d83060b5db385fd83a540de615",
  "v": "4b788b5e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-hole-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15504,
  "sha256": "bdf275491831ac23f7cdc5f9e92bd7d83b26b05ef17725ea81ac129c2d4289a1",
  "v": "bdf27549",
  "w": 384,
  "h": 288
 },
 "/examples/effect-hole-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 121558,
  "sha256": "78fc77ef5136a39d08e312a7153c37b473e49fa26cf71eedeae1dcc2fa5d1adf",
  "v": "78fc77ef",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-hole-transition/1/in-end-image.384.webp?v=bdf27549"
 },
 "/examples/effect-hole-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24650,
  "sha256": "fd213a8b272e2b80888afafd6eb8032178f3dfe23b06d92390c2bcafbf0e5572",
  "v": "fd213a8b",
  "w": 384,
  "h": 288
 },
 "/examples/effect-hole-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 173457,
  "sha256": "6a0484481038ae86e5bda25f20f1b7f3a3e2c0d883f56015b780c5230faea557",
  "v": "6a048448",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-hole-transition/1/in-image.384.webp?v=fd213a8b"
 },
 "/examples/effect-hole-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27735,
  "sha256": "cea2612cc5b0434a732455574b18e587024e9dee177242ea65baa09ea16b62e3",
  "v": "cea2612c",
  "w": 512,
  "h": 384
 },
 "/examples/effect-horror-face/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16672,
  "sha256": "3dcf137dafdd736b1cd25b0ab514df95cf89697bb8390e387e43962905578666",
  "v": "3dcf137d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-horror-face/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 124721,
  "sha256": "05f1baa79f4b66b6d7d77fec71d6812ed495d5c499db26c63da77eaced79be55",
  "v": "05f1baa7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-horror-face/1/in-image.384.webp?v=3dcf137d"
 },
 "/examples/effect-horror-face/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 15216,
  "sha256": "4cfcfd66fae074a20c02cbeb9770162e08719db06fa6a4fcba629eb50cd2aa94",
  "v": "4cfcfd66",
  "w": 512,
  "h": 384
 },
 "/examples/effect-hyper-neon/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17058,
  "sha256": "e7e686d0ebdac22aed31fc5c3f2edcdb2e01f57cb173350a54d0e88f976ccf47",
  "v": "e7e686d0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-hyper-neon/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126293,
  "sha256": "a7a65b985d1ebf46ed4f5ded9b6b1c89982d91a69b80c9e67027722016bcb149",
  "v": "a7a65b98",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-hyper-neon/1/in-image.384.webp?v=e7e686d0"
 },
 "/examples/effect-ice-rose/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21762,
  "sha256": "0b273c2ef9bf07f641fcf15bfff4b67355703295f731e28a8c8d7490f5d38d87",
  "v": "0b273c2e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-ice-rose/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 139429,
  "sha256": "3a679caa0662f6e7856e6f4a7f6029676f9e5555f1dd347b48990ed7d5234b9c",
  "v": "3a679caa",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-ice-rose/1/in-image.384.webp?v=0b273c2e"
 },
 "/examples/effect-innerlight/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11912,
  "sha256": "d9edf310f81ec9235421a1f4676294697338425bc2155e45662b7e07b922dc58",
  "v": "d9edf310",
  "w": 384,
  "h": 288
 },
 "/examples/effect-innerlight/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 98868,
  "sha256": "7c899859534580a3577a628decf3742226432c8f6eb2c8728bc576e0276b4812",
  "v": "7c899859",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-innerlight/1/in-image.384.webp?v=d9edf310"
 },
 "/examples/effect-innerlight/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26553,
  "sha256": "3710638f7a3cb1e7a773b697d35bd6337f3bbcd6547e6e564340dbf63f8984ef",
  "v": "3710638f",
  "w": 512,
  "h": 384
 },
 "/examples/effect-jump-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9174,
  "sha256": "e9d9974db9384137494855894496a5c0671ed12eccde58c000a4e433f86f5853",
  "v": "e9d9974d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-jump-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 77511,
  "sha256": "b5c7424d66d5b37a1802e546db9a7e4d2d2553ec3dde9685d45afdcb511a6255",
  "v": "b5c7424d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-jump-transition/1/in-end-image.384.webp?v=e9d9974d"
 },
 "/examples/effect-jump-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 35808,
  "sha256": "3b0520cf20779cd2deb1e66f039e7d8d09418128352fac7932dd49b487498390",
  "v": "3b0520cf",
  "w": 384,
  "h": 288
 },
 "/examples/effect-jump-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 229615,
  "sha256": "bdba2c79a958e5c57cc6c0a832258690e180c42b788eea3a58a2fa478735e7f0",
  "v": "bdba2c79",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-jump-transition/1/in-image.384.webp?v=3b0520cf"
 },
 "/examples/effect-lacewalker/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16912,
  "sha256": "7bf903c1132e0eb0272612c69bd2f255b51ed9b82aaf858290a9632abf9026d2",
  "v": "7bf903c1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-lacewalker/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 121946,
  "sha256": "211b3eb09a295ed1a7d7074e008df31872bb553da31920b11f6d53bbc0833619",
  "v": "211b3eb0",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-lacewalker/1/in-image.384.webp?v=7bf903c1"
 },
 "/examples/effect-lacewalker/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30832,
  "sha256": "c54f2eae4667b6976cc161a7c01d82b70ab80526d9d408b961be0ce63e3a7772",
  "v": "c54f2eae",
  "w": 512,
  "h": 384
 },
 "/examples/effect-lava/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16072,
  "sha256": "693231f4846afc93bc7e15fcaa60b7a7c29970fe96d7b44445c6d4f76e5719cb",
  "v": "693231f4",
  "w": 384,
  "h": 288
 },
 "/examples/effect-lava/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 113818,
  "sha256": "f6887584865c9dd92bf267955a2cd397e824232a0e564302ce17ccd49994205d",
  "v": "f6887584",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-lava/1/in-image.384.webp?v=693231f4"
 },
 "/examples/effect-lens-flare/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9696,
  "sha256": "80a6a0fbd5985f097ec15a1ff862d29f0d43077c4b48d71b94437fbffdca78ea",
  "v": "80a6a0fb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-lens-flare/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85521,
  "sha256": "127c66db8fb8ee1e7c4b1e97bceebdf6a815b4a59f9dcba05e217ebf575ef587",
  "v": "127c66db",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-lens-flare/1/in-image.384.webp?v=80a6a0fb"
 },
 "/examples/effect-levitation/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7886,
  "sha256": "c9e1dfdfcf572be268c8db3f059d7a3ec2db580c783240403c6e871b21bb6c08",
  "v": "c9e1dfdf",
  "w": 384,
  "h": 288
 },
 "/examples/effect-levitation/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 78212,
  "sha256": "b9e2989c538bdb9288c8d577b1af7f91167f7b894d4b698d824a6309e1bcdcaf",
  "v": "b9e2989c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-levitation/1/in-image.384.webp?v=c9e1dfdf"
 },
 "/examples/effect-lidar-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19684,
  "sha256": "bea2ede12857817f4b2054d9b2b1d1f9a6ca5183622aac501e868e996f6e2931",
  "v": "bea2ede1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-lidar-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 140544,
  "sha256": "801d34cb55cca9ee46af1bfced2ff43b782a70d270bacf87e326ef7a12f18781",
  "v": "801d34cb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-lidar-transition/1/in-image.384.webp?v=bea2ede1"
 },
 "/examples/effect-lidar-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27313,
  "sha256": "8151931b86bb32f2aa3292722d2d932cd179913db9d76ab0fd3aec5d2e46cacd",
  "v": "8151931b",
  "w": 512,
  "h": 384
 },
 "/examples/effect-lime-jam/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21760,
  "sha256": "73990ba4cf9e7eaac896d462e92da5d8d0351178fc699230ba9272a49f70e58a",
  "v": "73990ba4",
  "w": 384,
  "h": 288
 },
 "/examples/effect-lime-jam/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164021,
  "sha256": "0bc253ffaaf4c365dea40eb2b224465baa626d1ba09fa5223c6271b295aa2574",
  "v": "0bc253ff",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-lime-jam/1/in-image.384.webp?v=73990ba4"
 },
 "/examples/effect-look-boom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20198,
  "sha256": "20119196e2200b678e54150563d5beba9dbf515732f681d6028a0e6ec15f8161",
  "v": "20119196",
  "w": 384,
  "h": 288
 },
 "/examples/effect-look-boom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 139004,
  "sha256": "55f6398785c6b0bd9e731970a037362de09e8eb22b3b5eede8a453bb3b0aefcf",
  "v": "55f63987",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-look-boom/1/in-image.384.webp?v=20119196"
 },
 "/examples/effect-look-boom/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39522,
  "sha256": "c2284b7f7fc6c975616e536d482dec7a213836ac84466574c7061da15ac00f31",
  "v": "c2284b7f",
  "w": 512,
  "h": 384
 },
 "/examples/effect-luminous-gaze/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16242,
  "sha256": "f2c4f9e7a80ec6a55ae5313cf7eacd1bc1244855d7a7b96e18f57c4e32764f17",
  "v": "f2c4f9e7",
  "w": 384,
  "h": 288
 },
 "/examples/effect-luminous-gaze/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 105697,
  "sha256": "70d3c5de1eeeeaa6d403de8bc9246e5992f6fa2e84af80e2f6c183c0db305cb0",
  "v": "70d3c5de",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-luminous-gaze/1/in-image.384.webp?v=f2c4f9e7"
 },
 "/examples/effect-luminous-gaze/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29707,
  "sha256": "c8d663e0b2f6e3b38bdac3b1801ed80303efab9b4fd34d8a1c786fa4adee3f9c",
  "v": "c8d663e0",
  "w": 512,
  "h": 384
 },
 "/examples/effect-marble/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11082,
  "sha256": "91c5de909f9770ba7f6c42bf974a466337c1992c30f1fc6b50ee7c5951b8af52",
  "v": "91c5de90",
  "w": 384,
  "h": 288
 },
 "/examples/effect-marble/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89438,
  "sha256": "1d9aba8f88961223a17b015584508e1b6cb3db85a8c98b5bbeba6b3e87cc0707",
  "v": "1d9aba8f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-marble/1/in-image.384.webp?v=91c5de90"
 },
 "/examples/effect-medusa-gorgona/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 29202,
  "sha256": "9802aea165224d26b074f8f0915b81127b1a741ec430587c8673632eadec2e5b",
  "v": "9802aea1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-medusa-gorgona/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 168170,
  "sha256": "bf3b790bd42701f251d4b4d308650cb04d7aabd73ab8912a454f6e29023a6f9b",
  "v": "bf3b790b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-medusa-gorgona/1/in-image.384.webp?v=9802aea1"
 },
 "/examples/effect-medusa-gorgona/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 45029,
  "sha256": "96d7ee645af201b071953258408fb36bf7db36bbf648476ab25f2fc427c0d0e2",
  "v": "96d7ee64",
  "w": 512,
  "h": 384
 },
 "/examples/effect-melting/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19006,
  "sha256": "5183f80820493ecd57d5389cbcc65abbd9dcc57be308dfb39c2f54f22127ac25",
  "v": "5183f808",
  "w": 384,
  "h": 288
 },
 "/examples/effect-melting/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 150256,
  "sha256": "c62d16cfd86c5eb6db351bb954a1d476e1ae1724e0e3157f3faafd08357c682d",
  "v": "c62d16cf",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-melting/1/in-image.384.webp?v=5183f808"
 },
 "/examples/effect-melting/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 32933,
  "sha256": "c2e8bc749462862ae0f63684281735203d67468bf49d7cd8382f9221742a5d90",
  "v": "c2e8bc74",
  "w": 512,
  "h": 384
 },
 "/examples/effect-mighty-fighter/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19716,
  "sha256": "b8a0d8fbf57d1b1aec5937195870bacaba600262a755bc5fbc54320aaf7cbd68",
  "v": "b8a0d8fb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-mighty-fighter/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 128853,
  "sha256": "0fbec6234658bf07f670aa9b699d31629f0abbf519952310c71787dcd370a578",
  "v": "0fbec623",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-mighty-fighter/1/in-image.384.webp?v=b8a0d8fb"
 },
 "/examples/effect-mighty-fighter/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33555,
  "sha256": "6c1b197bc3f1fb6600cac3fcc15c38d488018f67a13e36fd85d4924189642357",
  "v": "6c1b197b",
  "w": 512,
  "h": 384
 },
 "/examples/effect-modern/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8116,
  "sha256": "4bbc304fb79ad9dd006b8ccab5ca4f8a307baad5624d9a4e264da8daf26e0448",
  "v": "4bbc304f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-modern/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 71178,
  "sha256": "c5bb1b3d235fa468af621613f321eb906e603bed224693cedc16fff9a76cc671",
  "v": "c5bb1b3d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-modern/1/in-image.384.webp?v=4bbc304f"
 },
 "/examples/effect-monet-muse/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 30004,
  "sha256": "d28e1f1be08e17297ec06d3d1c75bd09e67f4e631199fb7c823cb808c1b60c85",
  "v": "d28e1f1b",
  "w": 384,
  "h": 288
 },
 "/examples/effect-monet-muse/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 167960,
  "sha256": "547dd36a80280991df5c031d72273aca820e6aa51afac413cda0929d988b34a9",
  "v": "547dd36a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-monet-muse/1/in-image.384.webp?v=d28e1f1b"
 },
 "/examples/effect-money-rain/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20660,
  "sha256": "c3473fdf8cd464e1918a73f9633ddab03f8f4502bbe46aec8e10276aad0aca42",
  "v": "c3473fdf",
  "w": 384,
  "h": 288
 },
 "/examples/effect-money-rain/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 146521,
  "sha256": "e83aca2edbd33cf7e1362cf5e26132dc142cc6f20077dda9dae7ba4f17cd0ea2",
  "v": "e83aca2e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-money-rain/1/in-image.384.webp?v=c3473fdf"
 },
 "/examples/effect-money-rain/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39281,
  "sha256": "476f2e81f1c629211e77be42dcd8a8d504182bf18ca33388e6d3add567dbea1d",
  "v": "476f2e81",
  "w": 512,
  "h": 384
 },
 "/examples/effect-monster-dab/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18008,
  "sha256": "889c4cd936ba5e56e6e0f8bec1dceac3942ab45014cb9c58f7b77d0f5cbbef92",
  "v": "889c4cd9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-monster-dab/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132937,
  "sha256": "3e355c5bbc7159dd38752335f69beff8adf054f593c21e73d9a842e7d275d363",
  "v": "3e355c5b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-monster-dab/1/in-image.384.webp?v=889c4cd9"
 },
 "/examples/effect-monster-dab/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30789,
  "sha256": "5f6a55c9fd320ae15038e2b0aba71e707addb0e8ef6d460a7b676ac01e62dff2",
  "v": "5f6a55c9",
  "w": 512,
  "h": 384
 },
 "/examples/effect-morning-routine/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15174,
  "sha256": "ee080c0d2f7b83bab1b6ecba1144257640c1c0243fd9dd0f9003b827b3c3e197",
  "v": "ee080c0d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-morning-routine/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114631,
  "sha256": "c1a4f0ea7353dea856bdec56f7811a9113297ef0bdcf0e883a93bc7bf1c63669",
  "v": "c1a4f0ea",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-morning-routine/1/in-image.384.webp?v=ee080c0d"
 },
 "/examples/effect-morning-routine/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29312,
  "sha256": "d31816bb3d5849621a447dcf11bd2b0cf72041ad3ff6ec83863839f28b26bf19",
  "v": "d31816bb",
  "w": 512,
  "h": 384
 },
 "/examples/effect-morphskin/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12602,
  "sha256": "934738765ca6eda543ecc34857cd1a8d687ce22317f8daa89d5c7610d1b2d8a1",
  "v": "93473876",
  "w": 384,
  "h": 288
 },
 "/examples/effect-morphskin/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91692,
  "sha256": "f3214ccdea56982f815b6c2cc0969674012e31bfcf2dfaf779e5459fdf7ad874",
  "v": "f3214ccd",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-morphskin/1/in-image.384.webp?v=93473876"
 },
 "/examples/effect-motor-ride/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14882,
  "sha256": "09b4cdd54bdddb04de539c86b9352233ba5b03860272af1bc8abffd327ed12b0",
  "v": "09b4cdd5",
  "w": 384,
  "h": 288
 },
 "/examples/effect-motor-ride/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 106012,
  "sha256": "d72607840efd6d4651cc934493c0fdeff24f5dcde176b496fe7ed4e6248ea3ba",
  "v": "d7260784",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-motor-ride/1/in-image.384.webp?v=09b4cdd5"
 },
 "/examples/effect-motor-ride/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 23429,
  "sha256": "8bd20674acba6dceb7f66c8a9d4c3837d6934fbfcbc3da56cc4052ab89970954",
  "v": "8bd20674",
  "w": 512,
  "h": 384
 },
 "/examples/effect-multiverse/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 31378,
  "sha256": "89eeb534f1736cd6ae0b823263f778ff90d9269c6bee6418cd08bb63fd429e70",
  "v": "89eeb534",
  "w": 384,
  "h": 288
 },
 "/examples/effect-multiverse/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 179170,
  "sha256": "f0e9a081d20c7194cc0d4bcbe0f3028a03e28fc90f72f934e127f2fd25da74b8",
  "v": "f0e9a081",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-multiverse/1/in-image.384.webp?v=89eeb534"
 },
 "/examples/effect-muscle-up/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16820,
  "sha256": "daac7f2978bd561893677739cf55dadcb21c8259c7482e3f4b0746e7b396db1f",
  "v": "daac7f29",
  "w": 384,
  "h": 288
 },
 "/examples/effect-muscle-up/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111209,
  "sha256": "a52986a6bb1f7db576c4f7fa940d971feecd560bd2c789c6daa9a23d5579ceff",
  "v": "a52986a6",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-muscle-up/1/in-image.384.webp?v=daac7f29"
 },
 "/examples/effect-mystification/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11872,
  "sha256": "3a489df92bf2ec67148aeca5f064a8a0a45de7a9e73e57d4b11db2ac03b583bd",
  "v": "3a489df9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-mystification/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 104536,
  "sha256": "19a4a773846eacef41c9ea73abdf2af1651e250640bfdb0f6c87c7b830af6d62",
  "v": "19a4a773",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-mystification/1/in-image.384.webp?v=3a489df9"
 },
 "/examples/effect-naturalistic-clean/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15672,
  "sha256": "0bb1594bd868ed8b683b977e07a177b7eeac98e27b26f3a06dfff9377ca72827",
  "v": "0bb1594b",
  "w": 384,
  "h": 288
 },
 "/examples/effect-naturalistic-clean/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 127323,
  "sha256": "cc667c81ce7c658bf7964d2279fce1765f5f2fa456041d84206fee0a0c46f3f6",
  "v": "cc667c81",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-naturalistic-clean/1/in-image.384.webp?v=0bb1594b"
 },
 "/examples/effect-nature-bloom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21314,
  "sha256": "180c68cbf50b51b817ceefee2c42693acffa1ab89cd7589a11509a7998365f55",
  "v": "180c68cb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-nature-bloom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 135032,
  "sha256": "437219a3a1089a8addaa1972a4e211d7411e4ae01db5d1dfc6f27ae38560c743",
  "v": "437219a3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-nature-bloom/1/in-image.384.webp?v=180c68cb"
 },
 "/examples/effect-noir/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19946,
  "sha256": "42ad8075d2ce7c164cdbf15e3b1aa364105f8acf59b3d7393c328c363a55e537",
  "v": "42ad8075",
  "w": 384,
  "h": 288
 },
 "/examples/effect-noir/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 140722,
  "sha256": "f7fe27c3e68ee5b24e9a700bcd361df511f59426eafcbf02e840aec6f812aca8",
  "v": "f7fe27c3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-noir/1/in-image.384.webp?v=42ad8075"
 },
 "/examples/effect-northern-lights/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8054,
  "sha256": "9a2c15b0ee95a3235b4bdc82bac4bf26bd2512260fdf1f1e092d689ce1517b00",
  "v": "9a2c15b0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-northern-lights/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 73343,
  "sha256": "61f138123b2d23194efd6d5f82c03620118fe9b602ede13623080ee0be4f8ba1",
  "v": "61f13812",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-northern-lights/1/in-image.384.webp?v=9a2c15b0"
 },
 "/examples/effect-nostalgic-blue/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24636,
  "sha256": "e2801f7a03ade32eee47a1474cf089a99ba8c323069a422df27552ed207bef10",
  "v": "e2801f7a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-nostalgic-blue/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 159760,
  "sha256": "d266ef3145cc0afd7bd637e1ca6b63a2601ca0349cc6eada0cf20c2900be070d",
  "v": "d266ef31",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-nostalgic-blue/1/in-image.384.webp?v=e2801f7a"
 },
 "/examples/effect-objects-around/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18508,
  "sha256": "cb626205cfaa6c466716f310882583b79d3795cfb23550f12d6ee69c31747290",
  "v": "cb626205",
  "w": 384,
  "h": 288
 },
 "/examples/effect-objects-around/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132324,
  "sha256": "f18a930ffbd40586ece37ac58955abfc34659de2d0722cfc755479b1b1cbdf97",
  "v": "f18a930f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-objects-around/1/in-image.384.webp?v=cb626205"
 },
 "/examples/effect-oni-mask/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22938,
  "sha256": "557a23e5356eba9b6734161d357d64a08c49b005c0825635fc29049ebf8d2ee3",
  "v": "557a23e5",
  "w": 384,
  "h": 288
 },
 "/examples/effect-oni-mask/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 140704,
  "sha256": "d6087ab9dd3b4d84d75eb3408eb7d73cae4736879e9b3a506abd5749e87126e7",
  "v": "d6087ab9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-oni-mask/1/in-image.384.webp?v=557a23e5"
 },
 "/examples/effect-oni-mask/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37940,
  "sha256": "0c829582f930a91a8de2696de3966e890efcefc13ce7340892632ad99e277a3b",
  "v": "0c829582",
  "w": 512,
  "h": 384
 },
 "/examples/effect-outfit-switch/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21596,
  "sha256": "bb6635e13fca13cf01b19c2b113fd3a5281d2cbc071d0a1d18b9beccb11dff99",
  "v": "bb6635e1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-outfit-switch/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 163248,
  "sha256": "1ecb19b9d01e752f1690e06d1b2e9c74b3d0985f30d6f011801cc786f2d6324c",
  "v": "1ecb19b9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-outfit-switch/1/in-image.384.webp?v=bb6635e1"
 },
 "/examples/effect-overexposed/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14246,
  "sha256": "c97476ee25e2bdb056985043f129d52457b84c0fd1f495c16bb0dae2ef0d7ecd",
  "v": "c97476ee",
  "w": 384,
  "h": 288
 },
 "/examples/effect-overexposed/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108345,
  "sha256": "801587f428744b41f5bbd92024933a27fff28617c49042ac5d51d99d3e548ab4",
  "v": "801587f4",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-overexposed/1/in-image.384.webp?v=c97476ee"
 },
 "/examples/effect-paper/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21620,
  "sha256": "99845b9d126ad2dee80eec34f0e27b8614f6f196a480967dcbb913a11f8fd7f8",
  "v": "99845b9d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-paper/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 166119,
  "sha256": "997bf1e62ad977b7ebedd550bd50abe325825dc12245cf99d4c4f63d70130234",
  "v": "997bf1e6",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-paper/1/in-image.384.webp?v=99845b9d"
 },
 "/examples/effect-particles/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10442,
  "sha256": "90d49a6a1bd079aa811f8dc248ec6402dd903f41d6a517001f8e9b366d0f6bba",
  "v": "90d49a6a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-particles/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 84436,
  "sha256": "56a2ebe235b0fd4c7ba55e2e1e59b8e8f914debe11f72902f91f7f1d1d683d93",
  "v": "56a2ebe2",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-particles/1/in-image.384.webp?v=90d49a6a"
 },
 "/examples/effect-peak-moment/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23106,
  "sha256": "1ee775b0be3affd0761b06aa667d6fa4f21337d5d89b12408f4334e38b1dfa97",
  "v": "1ee775b0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-peak-moment/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 153105,
  "sha256": "f50689f03db2f92e84d8a1db48384f5f2204cada270c8aa00431554cb684ac78",
  "v": "f50689f0",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-peak-moment/1/in-image.384.webp?v=1ee775b0"
 },
 "/examples/effect-peak-moment/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 20307,
  "sha256": "7ca408d20cea5ec4a352b79fbd5412a3e49f729cd203ba7acb813185705e0694",
  "v": "7ca408d2",
  "w": 512,
  "h": 384
 },
 "/examples/effect-pearl-earring/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8856,
  "sha256": "1fa98e61ff6615ab801ab85f4f1c763b30c32481bbc6395608dce6466697f955",
  "v": "1fa98e61",
  "w": 384,
  "h": 288
 },
 "/examples/effect-pearl-earring/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 77753,
  "sha256": "8f853af94f0c09bf77fc4da5c43cef324ca4635ec920271b941910a5d10c3052",
  "v": "8f853af9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-pearl-earring/1/in-image.384.webp?v=1fa98e61"
 },
 "/examples/effect-pigeons/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19740,
  "sha256": "b12e77c62e04a63fdf2a7be378341bddbd1afa5bc820297c306fb39afc1c44ea",
  "v": "b12e77c6",
  "w": 384,
  "h": 288
 },
 "/examples/effect-pigeons/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 131022,
  "sha256": "d5cd5e5c16334e728bcc0fd760e2e19171ff2558f360b5e12911738a45380be2",
  "v": "d5cd5e5c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-pigeons/1/in-image.384.webp?v=b12e77c6"
 },
 "/examples/effect-pixelated-face/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9282,
  "sha256": "93eb057a4cebc3e47571036a1d088e9de8df20dc15e70587b70baa7742d2e30f",
  "v": "93eb057a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-pixelated-face/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 74212,
  "sha256": "f4205a6857f06d259d855b684dec8c4549308fbc3c31ddf8acf03686c5c25c25",
  "v": "f4205a68",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-pixelated-face/1/in-image.384.webp?v=93eb057a"
 },
 "/examples/effect-pizza-fall/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18574,
  "sha256": "9882888a03825529aa56eb09f11300ae0b4cc6979aef0ddac1140b3e7f21771f",
  "v": "9882888a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-pizza-fall/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 125869,
  "sha256": "4e723a168d4440d2b35063c0c7cf735ec973e21d67960cb8f23b551ed57b5413",
  "v": "4e723a16",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-pizza-fall/1/in-image.384.webp?v=9882888a"
 },
 "/examples/effect-pizza-fall/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 42155,
  "sha256": "e2c2da4b935a64469ed548610e1e1d09a20566ddff9ae9ce11b6d979de845913",
  "v": "e2c2da4b",
  "w": 512,
  "h": 384
 },
 "/examples/effect-plate-check/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20782,
  "sha256": "ca7ac116021a8a88dc2f57380194556fdb8632dd1a77a0653e54265f3aef2a0b",
  "v": "ca7ac116",
  "w": 384,
  "h": 288
 },
 "/examples/effect-plate-check/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 141358,
  "sha256": "184003d16ee1141be0fafe7a7950d069afc0b071a882a677402e40d53b99c344",
  "v": "184003d1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-plate-check/1/in-image.384.webp?v=ca7ac116"
 },
 "/examples/effect-plate-check/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 28565,
  "sha256": "009e711a74564205fcc8ab3cfdff708479de1da500fc3c8fcd5665310890d1db",
  "v": "009e711a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-polygon/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20432,
  "sha256": "1a3d1bdb29fcc04dbace2c09966ce43577645bff72b6bf12cee0b456a1dd648a",
  "v": "1a3d1bdb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-polygon/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 147040,
  "sha256": "b0ed9b032b94f9bf7ff6a57fafadff92dca6d19877225d0d9788a4cec9399b25",
  "v": "b0ed9b03",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-polygon/1/in-image.384.webp?v=1a3d1bdb"
 },
 "/examples/effect-polygon/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37746,
  "sha256": "ec02b9d96a0dd09c3aa5fd5f53999c3f854fcdf23878d718c2f64ad5f83c656c",
  "v": "ec02b9d9",
  "w": 512,
  "h": 384
 },
 "/examples/effect-powder-explosion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8994,
  "sha256": "a009eda76de632450e5628d3d1b554f1898a4284cb618f46da60d35157b1a000",
  "v": "a009eda7",
  "w": 384,
  "h": 288
 },
 "/examples/effect-powder-explosion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89651,
  "sha256": "f4b6e633de4fe5f887952575da58d63f31657e1ae6cda73f1ec52b066f48fda3",
  "v": "f4b6e633",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-powder-explosion/1/in-image.384.webp?v=a009eda7"
 },
 "/examples/effect-practicals/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13032,
  "sha256": "4b9fe9dc580a25ef15179613b3d6cf6a472635bd822620cb8c6a2471401edea7",
  "v": "4b9fe9dc",
  "w": 384,
  "h": 288
 },
 "/examples/effect-practicals/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 104099,
  "sha256": "9d1c6cb9e85a928393a7cad1e5314d236492ef83907ba6732936f3cd382de3c6",
  "v": "9d1c6cb9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-practicals/1/in-image.384.webp?v=4b9fe9dc"
 },
 "/examples/effect-push-to-glass/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14078,
  "sha256": "d7b3b5079f01e9e1e904c41b8a65ee9d6b8f7234fc323003e289396fff363c6d",
  "v": "d7b3b507",
  "w": 384,
  "h": 288
 },
 "/examples/effect-push-to-glass/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 98913,
  "sha256": "ae1dab1e5c3645cfe3af427020f984261528b370a8d34ab2796a675058a62399",
  "v": "ae1dab1e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-push-to-glass/1/in-image.384.webp?v=d7b3b507"
 },
 "/examples/effect-push-to-glass/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27163,
  "sha256": "10f5af72aec665beb86388d7c51fe186d95a6d0847f6db8ff0a24b85a3f3d74f",
  "v": "10f5af72",
  "w": 512,
  "h": 384
 },
 "/examples/effect-random-glow/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9712,
  "sha256": "ffe7208578fea16b6552d5715bcde6191b64073f9cbe2634628bc90f3da91b01",
  "v": "ffe72085",
  "w": 384,
  "h": 288
 },
 "/examples/effect-random-glow/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 85064,
  "sha256": "287bcabb680fa3290f5d808ca2842e8ac49eed1279ab844f6c5dc232595b1b9e",
  "v": "287bcabb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-random-glow/1/in-image.384.webp?v=ffe72085"
 },
 "/examples/effect-raven-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14416,
  "sha256": "ceb4f11fd8da0628c316d91b960610cedea7f438bfa25d73cd7f891061eb3379",
  "v": "ceb4f11f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-raven-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 93164,
  "sha256": "40d1ac4621bec22147f0b10426aaec1df20d621c7e130e856ad84b8246e13b39",
  "v": "40d1ac46",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-raven-transition/1/in-image.384.webp?v=ceb4f11f"
 },
 "/examples/effect-red-carpet/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17418,
  "sha256": "72e355bb317acdd334fd3613b543dd13755a6a20426f5840e680a0295d76b42d",
  "v": "72e355bb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-red-carpet/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 105429,
  "sha256": "05f1f61e5068f9a18a8d7a1a826dcc6bb342c58982ed92c01bb831a4e20af6c6",
  "v": "05f1f61e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-red-carpet/1/in-image.384.webp?v=72e355bb"
 },
 "/examples/effect-red-carpet/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30910,
  "sha256": "40257968301c3543be79dd49884c14c729272fc2dd53daaab18136ede87181be",
  "v": "40257968",
  "w": 512,
  "h": 384
 },
 "/examples/effect-saint-glow/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15946,
  "sha256": "afdc9d16d4b35064ef0ac6af390e520d64b45b319d3d010473ed7100bb4caf7a",
  "v": "afdc9d16",
  "w": 384,
  "h": 288
 },
 "/examples/effect-saint-glow/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111901,
  "sha256": "bfbf29f33a242051e2d49f86a46bcb60f51ed43c5050ced02b11a7b424cf5760",
  "v": "bfbf29f3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-saint-glow/1/in-image.384.webp?v=afdc9d16"
 },
 "/examples/effect-sakura-petals/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 30400,
  "sha256": "0493c2095b52eb8227eba9a712e6ecb88eba168161e2be18c68d82e76dfa73a1",
  "v": "0493c209",
  "w": 384,
  "h": 288
 },
 "/examples/effect-sakura-petals/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 179214,
  "sha256": "b13578db0811d6b3d0f0c2366594d71050125dbfc200e51cf9e8ef48b2fddb36",
  "v": "b13578db",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-sakura-petals/1/in-image.384.webp?v=0493c209"
 },
 "/examples/effect-sakura-petals/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 45139,
  "sha256": "c18d3e1817ff8c7f93abce4821605c0a00f36b1956ce62b672e3ed7a88e2d64e",
  "v": "c18d3e18",
  "w": 512,
  "h": 384
 },
 "/examples/effect-sand-storm/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11618,
  "sha256": "89387320bb991f543f7581e8df17c3d32ac8426f389867e2c92cefcc66c43413",
  "v": "89387320",
  "w": 384,
  "h": 288
 },
 "/examples/effect-sand-storm/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91473,
  "sha256": "b882471c9e0e4c7900fe347388e85df0bb12e9a982b061bab37c5e37142eb22d",
  "v": "b882471c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-sand-storm/1/in-image.384.webp?v=89387320"
 },
 "/examples/effect-scrapbook-collage/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23348,
  "sha256": "9e5cea9c579c4a042fe489b704558ac9a3a2ea2461e640186925eaad13fa5da5",
  "v": "9e5cea9c",
  "w": 384,
  "h": 288
 },
 "/examples/effect-scrapbook-collage/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165895,
  "sha256": "e281e3399b83a4907fd98113c672f7b2e763bec74df9f4841b33ab2a17793bb2",
  "v": "e281e339",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-scrapbook-collage/1/in-image.384.webp?v=9e5cea9c"
 },
 "/examples/effect-selfception/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24948,
  "sha256": "ddc1bfb9b8d3bf3b95b44a451ebbcca19ae9ff50a5e4bb399d47dd0c56fb26c8",
  "v": "ddc1bfb9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-selfception/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 142322,
  "sha256": "16ad69f57f00c31357d4003c0c1a4b81a66d10c65ade892a9fa209c9af54fba5",
  "v": "16ad69f5",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-selfception/1/in-image.384.webp?v=ddc1bfb9"
 },
 "/examples/effect-selfception/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29882,
  "sha256": "e1b939a8bed2d0cbf945b74cf18387c92b11ed35a5aff14b611dc3b4b036b114",
  "v": "e1b939a8",
  "w": 512,
  "h": 384
 },
 "/examples/effect-selfie-outfit/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19934,
  "sha256": "84df5e040791a4b19f49964f027614f419aa6d1fb70faa52c797a54fbceb50a7",
  "v": "84df5e04",
  "w": 384,
  "h": 288
 },
 "/examples/effect-selfie-outfit/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115130,
  "sha256": "616dba3487fc85fd0b9e5d99b41ebd93a6d68fdecc888206c63d79bd9dc150c6",
  "v": "616dba34",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-selfie-outfit/1/in-image.384.webp?v=84df5e04"
 },
 "/examples/effect-selfie-outfit/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31403,
  "sha256": "f2edc9a395c4114947fc032060d98e18ae8641ff8a6bc35adf552a2be9b2f042",
  "v": "f2edc9a3",
  "w": 512,
  "h": 384
 },
 "/examples/effect-selfie-posing/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23704,
  "sha256": "5ee6d6392c0122092bef16b8ba75a68e105a2cf1d36f06c14551cdef3adb5eb7",
  "v": "5ee6d639",
  "w": 384,
  "h": 288
 },
 "/examples/effect-selfie-posing/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 157397,
  "sha256": "f70569b7ed2faefb4002fa528ff9c0838cbcadb38c6e6012be1073886ffe1e8c",
  "v": "f70569b7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-selfie-posing/1/in-image.384.webp?v=5ee6d639"
 },
 "/examples/effect-selfie/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17144,
  "sha256": "fd4fb908755a14de0071e07f866664af4ed04da8d7fe47207e402eede867660f",
  "v": "fd4fb908",
  "w": 384,
  "h": 288
 },
 "/examples/effect-selfie/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 121090,
  "sha256": "0471686e2456cc62196b18c0e58526260af38083c0b9dbe211f5256e5611b0a1",
  "v": "0471686e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-selfie/1/in-image.384.webp?v=fd4fb908"
 },
 "/examples/effect-shadow-smoke/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11446,
  "sha256": "c6ba2b753f723ea428c2436b5f907b45221764d0c7cbbeca016e7c7ebfc137b2",
  "v": "c6ba2b75",
  "w": 384,
  "h": 288
 },
 "/examples/effect-shadow-smoke/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91174,
  "sha256": "b63349344becaeba829bcebd4ed3b221c66ba7ebe8f696450e9f5fbedf4988f4",
  "v": "b6334934",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-shadow-smoke/1/in-image.384.webp?v=c6ba2b75"
 },
 "/examples/effect-silhouette/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9188,
  "sha256": "085140f15455930ad314e074e739b607aae28ddb82bb70c354378b2f9c34da9d",
  "v": "085140f1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-silhouette/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83071,
  "sha256": "e281ebcd4747c05dac3578daac33fa18693d99bd9459d6d8946a265cefcb6d35",
  "v": "e281ebcd",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-silhouette/1/in-image.384.webp?v=085140f1"
 },
 "/examples/effect-skatedog/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19556,
  "sha256": "96b8b5379ac555edc7862a99eb13d79c4fceb236f62b38b3e83f5c797ee73b81",
  "v": "96b8b537",
  "w": 384,
  "h": 288
 },
 "/examples/effect-skatedog/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 139911,
  "sha256": "430f8e5161075231c6a19ec70f4e9ae1a933e68b72e872a4c35fcd520b4d922f",
  "v": "430f8e51",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-skatedog/1/in-image.384.webp?v=96b8b537"
 },
 "/examples/effect-sketch/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21458,
  "sha256": "170eec34f8b861493ed856f3894c2c8521c8906649d12ed270e2ce277ed4c24f",
  "v": "170eec34",
  "w": 384,
  "h": 288
 },
 "/examples/effect-sketch/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 137793,
  "sha256": "b34aa9236d2154446d22f0ae6743cd2e405b9512faeec4063a72090182619f92",
  "v": "b34aa923",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-sketch/1/in-image.384.webp?v=170eec34"
 },
 "/examples/effect-smoke-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12572,
  "sha256": "7212ca9e581afa610b83fe728906daa47db5bd67a988e21213d1abee8a38639f",
  "v": "7212ca9e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-smoke-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89107,
  "sha256": "f8518b9101aad6d18853ff896b60847b2e5e56b925b02fb66d93099223efe408",
  "v": "f8518b91",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-smoke-transition/1/in-end-image.384.webp?v=7212ca9e"
 },
 "/examples/effect-smoke-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17656,
  "sha256": "4bf077d1f17da342e9fd6d388cc2d603b5428d2791b927594964d752d2a33575",
  "v": "4bf077d1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-smoke-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 121284,
  "sha256": "5328fe36a5ae6fd2299ed504a9ec857030fb60ca44cfc1d811c4da11dda08120",
  "v": "5328fe36",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-smoke-transition/1/in-image.384.webp?v=4bf077d1"
 },
 "/examples/effect-smoke-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 16372,
  "sha256": "dad6ddac75c499fa196ae7235132ea38df7060581656cb867a6be01ad190c7b2",
  "v": "dad6ddac",
  "w": 512,
  "h": 384
 },
 "/examples/effect-sodium-decay/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22530,
  "sha256": "3b73895b7084be362c4b318f6959ae6dd7484f8c12f8a32c57608b1c166d9338",
  "v": "3b73895b",
  "w": 384,
  "h": 288
 },
 "/examples/effect-sodium-decay/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 150733,
  "sha256": "5612b75309c6c52dbc592ac203e05e7dd4c059c29a35eba935e08f4d3ac5665a",
  "v": "5612b753",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-sodium-decay/1/in-image.384.webp?v=3b73895b"
 },
 "/examples/effect-soft-cross/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8202,
  "sha256": "ba457e5e65945cb2dbb584a0bca4ef13ed4e807859545097f2e972d6d2df6af8",
  "v": "ba457e5e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-soft-cross/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 78778,
  "sha256": "da885c95e1927e624712d77312adb80c4546b1f0fe38401aa50177c0f67c1767",
  "v": "da885c95",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-soft-cross/1/in-image.384.webp?v=ba457e5e"
 },
 "/examples/effect-soft-cross/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 15232,
  "sha256": "29e5427cc47e108534d84849de72486c4d15176e870dd82aaa59cc4746d243cc",
  "v": "29e5427c",
  "w": 512,
  "h": 384
 },
 "/examples/effect-soft-palette/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24712,
  "sha256": "2725e305fd8397f2e24a3bf9b48a93a58ef37931a414d412ee4fc2a0511dbbc9",
  "v": "2725e305",
  "w": 384,
  "h": 288
 },
 "/examples/effect-soft-palette/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 152407,
  "sha256": "c3dee3aa773cbfcaaadcb9866ce41c3c6186d3c279da563ff98b5fe6615a02d2",
  "v": "c3dee3aa",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-soft-palette/1/in-image.384.webp?v=2725e305"
 },
 "/examples/effect-soul-jump/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8114,
  "sha256": "eaf249bae61bac593cdb999715e949a1444db1f8cbd4cb98953b2c80e6b46477",
  "v": "eaf249ba",
  "w": 384,
  "h": 288
 },
 "/examples/effect-soul-jump/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 100241,
  "sha256": "40189195d31ef17a00c207f6d62a8bd65fe17f53f9392e8acf47426e92a8a813",
  "v": "40189195",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-soul-jump/1/in-image.384.webp?v=eaf249ba"
 },
 "/examples/effect-spiders-from-mouth/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15444,
  "sha256": "6715ad575ad846956613ba2bab59719a535cdd7bab721cd80c7921ad69698d9b",
  "v": "6715ad57",
  "w": 384,
  "h": 288
 },
 "/examples/effect-spiders-from-mouth/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115592,
  "sha256": "107f7cc6a391e0b19ffdcaa6c807e99a985fff9256fcafc80b8a7dc49d691f3a",
  "v": "107f7cc6",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-spiders-from-mouth/1/in-image.384.webp?v=6715ad57"
 },
 "/examples/effect-spiders-from-mouth/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27974,
  "sha256": "cc60e3ab4e34b418a67628d5c94d1d61cc44ac3870adcf99643534fd62a51b08",
  "v": "cc60e3ab",
  "w": 512,
  "h": 384
 },
 "/examples/effect-spirit-animal/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 29272,
  "sha256": "4f1eaa9ccdd29b288561462797b53cfabb62cfa2b43510cb42c8563ff99a7ccc",
  "v": "4f1eaa9c",
  "w": 384,
  "h": 288
 },
 "/examples/effect-spirit-animal/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165079,
  "sha256": "39587ff8f20381fe2afd41556e44fbde1a74aabed4b9186d537a9aa12b5e37e1",
  "v": "39587ff8",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-spirit-animal/1/in-image.384.webp?v=4f1eaa9c"
 },
 "/examples/effect-squish/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 3202,
  "sha256": "a74c704fda0cf232a7709987c5f9579e8e54d1fc47787daabbb9b0eb6c84deb7",
  "v": "a74c704f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-squish/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 29423,
  "sha256": "0bf99000a7020c979f1e3e11189f1377a2853ae4523ccd824583addb54e95f05",
  "v": "0bf99000",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-squish/1/in-image.384.webp?v=a74c704f"
 },
 "/examples/effect-squish/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 15628,
  "sha256": "488da494d3280121b3e24160b1ae8f5fcf3892039748d8a73c6e36411eca69e7",
  "v": "488da494",
  "w": 512,
  "h": 384
 },
 "/examples/effect-starship-troopers/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9916,
  "sha256": "69aa555e87094277e92dd77edd4f009173f4110148312f11b8c62e8fba3d6184",
  "v": "69aa555e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-starship-troopers/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 94670,
  "sha256": "5e12fb693766589ec737769e4652b4b761e9916c97c006f1c38d74ad29eb1f4e",
  "v": "5e12fb69",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-starship-troopers/1/in-image.384.webp?v=69aa555e"
 },
 "/examples/effect-starship-troopers/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24129,
  "sha256": "8fc0c76e10f1f14d4c9c79c8778082dd4f459c24b65af8aaceeae260c8daf07c",
  "v": "8fc0c76e",
  "w": 512,
  "h": 384
 },
 "/examples/effect-stop-world/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 30452,
  "sha256": "10b814151f9d7844ce15de1683d72fceb6f797da267147d0ebb4543fd6bec1d0",
  "v": "10b81415",
  "w": 384,
  "h": 288
 },
 "/examples/effect-stop-world/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 199296,
  "sha256": "fc133127a885b7f8ba422c347b63cd728f8b8b4ce2a823b258eb023b9ab1f312",
  "v": "fc133127",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-stop-world/1/in-image.384.webp?v=10b81415"
 },
 "/examples/effect-stop-world/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 47389,
  "sha256": "045aa13472d1f1966a1beabc80cccbfe3b3a8c9e589332f01e36c481f179f748",
  "v": "045aa134",
  "w": 512,
  "h": 384
 },
 "/examples/effect-studio-slide/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5044,
  "sha256": "98f0b497375bbd8e38522312f224cc8dc3efd6eac2a7d612a423692510db96e5",
  "v": "98f0b497",
  "w": 384,
  "h": 288
 },
 "/examples/effect-studio-slide/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 43502,
  "sha256": "9187bd17dea469f0efe0f0dd1fb257d891e191a1c43641f360ae9afdd5e62737",
  "v": "9187bd17",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-studio-slide/1/in-image.384.webp?v=98f0b497"
 },
 "/examples/effect-studio-slide/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 10187,
  "sha256": "be77f272ed7ef59359244336aae3fb8d8108a9b83dd240045f7da108318c3a8f",
  "v": "be77f272",
  "w": 512,
  "h": 384
 },
 "/examples/effect-sunglasses/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23396,
  "sha256": "646f78d095ef6d59c3a65720fd32c097576d5f01793d5fd62ca44244da37454d",
  "v": "646f78d0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-sunglasses/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 141029,
  "sha256": "4f0b758a5df0197cbceb9033a12138335cbb9923b2782a5ca229b9eb48e8b7a0",
  "v": "4f0b758a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-sunglasses/1/in-image.384.webp?v=646f78d0"
 },
 "/examples/effect-sunglasses/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26247,
  "sha256": "f2e1d47d98ef2b4a9319e1cbf71a10976d8a5d6e4b24f96ccb0adfa159797664",
  "v": "f2e1d47d",
  "w": 512,
  "h": 384
 },
 "/examples/effect-super-saiyan/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15194,
  "sha256": "dbcc37c1a2e5d7a585b1832f9f041a90cd116ee963bf9fe8717ed53d69b8088a",
  "v": "dbcc37c1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-super-saiyan/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114285,
  "sha256": "bfa5ed32c0c1cfd52011c6ea78f565363e7ea00255b5b3b88b2837b8d9acc7ea",
  "v": "bfa5ed32",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-super-saiyan/1/in-image.384.webp?v=dbcc37c1"
 },
 "/examples/effect-super-saiyan/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31657,
  "sha256": "d2a4fc4a3deb2449e96e1616c707c9c4d75cafc3f63c52649d3631f71be2c62c",
  "v": "d2a4fc4a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-superstar/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10280,
  "sha256": "f0f9d894a0420e29a040c2d33b0f277e3fdce4df3821b5c1136799444929117d",
  "v": "f0f9d894",
  "w": 384,
  "h": 288
 },
 "/examples/effect-superstar/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 88309,
  "sha256": "16919beea4df9a3e6fdb19702a6453f86c562f901dbdccae66b2fd3e2ce5326a",
  "v": "16919bee",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-superstar/1/in-image.384.webp?v=f0f9d894"
 },
 "/examples/effect-tattoo-animation/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13630,
  "sha256": "9aadd8b1c1be65b46dc34e8c1714c5a62fd0e859afda4c8ea7908ac80bc9ed48",
  "v": "9aadd8b1",
  "w": 384,
  "h": 288
 },
 "/examples/effect-tattoo-animation/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 95455,
  "sha256": "77afe734de5d0de28b32c50136972301e9ff26c7b11d57f93eccca9aa5a4e163",
  "v": "77afe734",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-tattoo-animation/1/in-image.384.webp?v=9aadd8b1"
 },
 "/examples/effect-tattoo-animation/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29095,
  "sha256": "06394857267c5ed7e94c29bb9d52368c180dd603fefaee8f707ef38760963c21",
  "v": "06394857",
  "w": 512,
  "h": 384
 },
 "/examples/effect-teal-orange-epic/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16906,
  "sha256": "a2805551d0680460f90f4ac013a855d6108c76c20d00568f6fceae991cc33d3f",
  "v": "a2805551",
  "w": 384,
  "h": 288
 },
 "/examples/effect-teal-orange-epic/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 112095,
  "sha256": "e809855e64a64ee289a583f8d340cbe58ea117f7bfb94576463ef9b4f014b8fe",
  "v": "e809855e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-teal-orange-epic/1/in-image.384.webp?v=a2805551"
 },
 "/examples/effect-tentacles/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9020,
  "sha256": "0a3d3118d77df2114dca5969e9212e37208b57dc9b35016fbc44df6169c042a5",
  "v": "0a3d3118",
  "w": 384,
  "h": 288
 },
 "/examples/effect-tentacles/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 77688,
  "sha256": "79aa84937a4b13c7c98ea504ccdda80e470b50fac4c031f2f84e1af42b3196bc",
  "v": "79aa8493",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-tentacles/1/in-image.384.webp?v=0a3d3118"
 },
 "/examples/effect-tentacles/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 20292,
  "sha256": "60db39f67dc063704b4e0eefc0b560486291d55f99ac48855e2728c2e9093436",
  "v": "60db39f6",
  "w": 512,
  "h": 384
 },
 "/examples/effect-thunder-god/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16058,
  "sha256": "50d490d9815a189e47cc0f1fdb620039fcb4b3976cc797126f8ef43e8c912529",
  "v": "50d490d9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-thunder-god/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 109072,
  "sha256": "2f882c7945cb3baf57c5311d090848d4942ba2c1260710805381cb3712e9ed64",
  "v": "2f882c79",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-thunder-god/1/in-image.384.webp?v=50d490d9"
 },
 "/examples/effect-tiny-planet/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25830,
  "sha256": "1c0393c323eac169ef5f44f058fe830ff5753486cc2bc6b38ebc9aee6bcd5917",
  "v": "1c0393c3",
  "w": 384,
  "h": 288
 },
 "/examples/effect-tiny-planet/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 182719,
  "sha256": "8654b477a669fb9a14c474ef2b80b27c956c5aed093f9ebcdedaa3d5f6951fa2",
  "v": "8654b477",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-tiny-planet/1/in-image.384.webp?v=1c0393c3"
 },
 "/examples/effect-toxic/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10882,
  "sha256": "b098a274e7f9462e4041e65ac2fe5da55048ae59f47413575390f8740332d2cf",
  "v": "b098a274",
  "w": 384,
  "h": 288
 },
 "/examples/effect-toxic/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89649,
  "sha256": "fd0614b0ba6798d44e57404e203ca25e77c8b75e256bfcd3ccb89e3973e41e58",
  "v": "fd0614b0",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-toxic/1/in-image.384.webp?v=b098a274"
 },
 "/examples/effect-tracking/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11470,
  "sha256": "3ce2155a9f0692d6b8df98d08f9f66ea4ef2f379567e3e2f7f3c0b7f38a2c40c",
  "v": "3ce2155a",
  "w": 384,
  "h": 288
 },
 "/examples/effect-tracking/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 91912,
  "sha256": "e817923ce2d66fb9f19aee0762e245a1c2eaa23ffa31ec9b4a0eeafd1fd25684",
  "v": "e817923c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-tracking/1/in-image.384.webp?v=3ce2155a"
 },
 "/examples/effect-train-rush/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17694,
  "sha256": "41b7f957825c69d11106a20f3f1e531267234a2ee6e40cbbe7de46d2f09202aa",
  "v": "41b7f957",
  "w": 384,
  "h": 288
 },
 "/examples/effect-train-rush/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 125821,
  "sha256": "a6d075e376babeaa8c75d57b63bf060d515f8124179497cb69fdee04499e7743",
  "v": "a6d075e3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-train-rush/1/in-image.384.webp?v=41b7f957"
 },
 "/examples/effect-turn-into-statue/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17540,
  "sha256": "aba5927f85ca837805333c4f0543db06b164dc0b08f194c1cc7b852186a014a4",
  "v": "aba5927f",
  "w": 384,
  "h": 288
 },
 "/examples/effect-turn-into-statue/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 116801,
  "sha256": "f61145bc6ad127eb68441c2ffd5a2a0bad4500d87b178d737640a352e460ec37",
  "v": "f61145bc",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-turn-into-statue/1/in-image.384.webp?v=aba5927f"
 },
 "/examples/effect-turn-into-statue/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33117,
  "sha256": "f2ed42421ee765f8c922c5541c99b60b284ef464c4f41556d240e9ec286aa6d4",
  "v": "f2ed4242",
  "w": 512,
  "h": 384
 },
 "/examples/effect-turning-metal/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11462,
  "sha256": "564d36276afdf9a7cec4135ed61a7d5bd67046e1c6b54bc30c8816dfcfcd3f90",
  "v": "564d3627",
  "w": 384,
  "h": 288
 },
 "/examples/effect-turning-metal/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 92812,
  "sha256": "1ca59c10cf2cc35fec20e0ac6be574fa2a094ea4a5f425705476b70faa21e39b",
  "v": "1ca59c10",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-turning-metal/1/in-image.384.webp?v=564d3627"
 },
 "/examples/effect-turning-monkey/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 30604,
  "sha256": "cc6e187dee7b8fb573872ab36cacf6fdc70d55b8036e935514afb93c1ca8518d",
  "v": "cc6e187d",
  "w": 384,
  "h": 288
 },
 "/examples/effect-turning-monkey/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 163854,
  "sha256": "13b2a1a4c5c0e49b6a6780d385cb6e22d2c17968e5e71da3bfc96ec63968f9f4",
  "v": "13b2a1a4",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-turning-monkey/1/in-image.384.webp?v=cc6e187d"
 },
 "/examples/effect-turning-monkey/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 48995,
  "sha256": "37e180feb656cdffc7b6180e57cffe80701b8eee146fa7ed21440dc9b2ca04dc",
  "v": "37e180fe",
  "w": 512,
  "h": 384
 },
 "/examples/effect-vintage/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23314,
  "sha256": "676880ad3c40ce038f7c8a99bdc91290db8424bd3599bf2e2f8b5d65d24fe625",
  "v": "676880ad",
  "w": 384,
  "h": 288
 },
 "/examples/effect-vintage/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 153270,
  "sha256": "98961fdc3493d53e609b4f49f0ece30552c5ada35bd4b8ddd9528f3b3d279646",
  "v": "98961fdc",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-vintage/1/in-image.384.webp?v=676880ad"
 },
 "/examples/effect-visor-x/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20348,
  "sha256": "78c96cd6608b0c119f0fd5af413779831b617ce7b04d6132422a4b67282f97a6",
  "v": "78c96cd6",
  "w": 384,
  "h": 288
 },
 "/examples/effect-visor-x/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115531,
  "sha256": "a73f2ddff0a323be9c5c38ca7a0b53a0616433cf5d2668cd50eecd8f52fc3583",
  "v": "a73f2ddf",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-visor-x/1/in-image.384.webp?v=78c96cd6"
 },
 "/examples/effect-visor-x/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 40004,
  "sha256": "e008936aeb8ca58955fe979421517941a26670b66520898288f5d8f78ee295da",
  "v": "e008936a",
  "w": 512,
  "h": 384
 },
 "/examples/effect-water-bending/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20444,
  "sha256": "284c5dd8312451345ad2f73abe52d14341c013cf42fb210a5aee73fb27df1f10",
  "v": "284c5dd8",
  "w": 384,
  "h": 288
 },
 "/examples/effect-water-bending/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132194,
  "sha256": "8bf6525b4d1525f116a9fbd045c4f86dc8d4efb54f8dbc9b216137151acf2163",
  "v": "8bf6525b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-water-bending/1/in-image.384.webp?v=284c5dd8"
 },
 "/examples/effect-water-bending/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38011,
  "sha256": "a93b110f1fabc0666602f6a8132b1dae3945f978948a400ccd76e3988dd8c0b5",
  "v": "a93b110f",
  "w": 512,
  "h": 384
 },
 "/examples/effect-werewolf/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15038,
  "sha256": "ee88502e72fbdd58e941f7971b9419ae205cf6d647c705a58224304a5048d046",
  "v": "ee88502e",
  "w": 384,
  "h": 288
 },
 "/examples/effect-werewolf/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 110355,
  "sha256": "ef4860c9cb5a6eb9269587c99f0e5a46cdbf226d9ac7b11359c87ad6057cd7b0",
  "v": "ef4860c9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-werewolf/1/in-image.384.webp?v=ee88502e"
 },
 "/examples/effect-werewolf/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27818,
  "sha256": "f30718d035ddf8140a48a8c7c2cb28630503ef2f2c8f4dc1bcbab945e50bb695",
  "v": "f30718d0",
  "w": 512,
  "h": 384
 },
 "/examples/effect-wind-to-face/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13188,
  "sha256": "1d8a80019de5dd14cb504764d90b995d73d9de0012c522d1431da15317846793",
  "v": "1d8a8001",
  "w": 384,
  "h": 288
 },
 "/examples/effect-wind-to-face/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 92272,
  "sha256": "d771c0ed95cdb777020c3c5f90842306955e31218006a4dc72a50d4b56804df8",
  "v": "d771c0ed",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-wind-to-face/1/in-image.384.webp?v=1d8a8001"
 },
 "/examples/effect-windows/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16964,
  "sha256": "5a3a84ab65d04c6d7ccda3067f6bfdeb2081bc1ac0dd523eac720b3dc96df52a",
  "v": "5a3a84ab",
  "w": 384,
  "h": 288
 },
 "/examples/effect-windows/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 123379,
  "sha256": "7820736b28ab67dcb2758e6644e79e0bc20fd956f3e4ac6f4b3017e5f14dbd0d",
  "v": "7820736b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-windows/1/in-image.384.webp?v=5a3a84ab"
 },
 "/examples/effect-wireframe/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5788,
  "sha256": "22680fead69149357040681b7386ebe666c8f616178278c7c4cf658f9b263d18",
  "v": "22680fea",
  "w": 384,
  "h": 288
 },
 "/examples/effect-wireframe/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 58030,
  "sha256": "efecbbbf17cf878c0d7600d7ca967d48b7a5fd612f3b662d712c9b46e6bdab74",
  "v": "efecbbbf",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-wireframe/1/in-image.384.webp?v=22680fea"
 },
 "/examples/effect-wonderland/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16356,
  "sha256": "0af1ea02d71fd739e64201bcccb7cb370fa3d8196ea3d401beaa3eacfc552441",
  "v": "0af1ea02",
  "w": 384,
  "h": 288
 },
 "/examples/effect-wonderland/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111042,
  "sha256": "2670d4ce0dde5936cefb53bc80c5e2ada269f5b1f7e1c187cbf4735c7d55e9f3",
  "v": "2670d4ce",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-wonderland/1/in-image.384.webp?v=0af1ea02"
 },
 "/examples/effect-world-morphing/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14728,
  "sha256": "383fe7e026104ec4439c4e48604401f419722478a7fcc96235a0630b2c3eff5c",
  "v": "383fe7e0",
  "w": 384,
  "h": 288
 },
 "/examples/effect-world-morphing/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 103347,
  "sha256": "6a97503ec11aa814c6955ced20434f759232db4be26ef8f03e5b5b5b954b8e68",
  "v": "6a97503e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-world-morphing/1/in-image.384.webp?v=383fe7e0"
 },
 "/examples/effect-world-morphing/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30399,
  "sha256": "2b4bbac30d6429cb1feea7acbbd86f75b12d954d5852a17574e7d9cfe684bfe8",
  "v": "2b4bbac3",
  "w": 512,
  "h": 384
 },
 "/examples/effect-x-ray/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 3658,
  "sha256": "7e84dbd91eb07d12799bf35ce729d6caf99e4f5b654e4dd3074c9e5da57467ff",
  "v": "7e84dbd9",
  "w": 384,
  "h": 288
 },
 "/examples/effect-x-ray/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 34133,
  "sha256": "23a72037ea04ac402389a1eceb117df6fac21928a870db37875ab10c4f2ba9d7",
  "v": "23a72037",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-x-ray/1/in-image.384.webp?v=7e84dbd9"
 },
 "/examples/effect-x-ray/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 13682,
  "sha256": "d760efe39ff069ad436df44daf79f582e3dfc70a2a370dbf7896aecba1282666",
  "v": "d760efe3",
  "w": 512,
  "h": 384
 },
 "/examples/effect-yacht/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18214,
  "sha256": "ff963dcba305566f3193aff94be981ed7ffaa47d1cf948f160c9c8051a8848e9",
  "v": "ff963dcb",
  "w": 384,
  "h": 288
 },
 "/examples/effect-yacht/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 133670,
  "sha256": "7efc8e8d657213602afeb1011e8c9659650ffa0e8f5dc52cec8457cdaec7810f",
  "v": "7efc8e8d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/effect-yacht/1/in-image.384.webp?v=ff963dcb"
 },
 "/examples/effect-yacht/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 32296,
  "sha256": "b9ff80ec35805401f288218861ef67728db25edd78703481bf92ffdb52544df6",
  "v": "b9ff80ec",
  "w": 512,
  "h": 384
 },
 "/examples/genjutsu-character/1/in-clip.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20494,
  "sha256": "7330bccee37efff3bb27bbc6f4b19af7398ef161ed6d157357d7dfcb3c581025",
  "v": "7330bcce",
  "w": 384,
  "h": 288
 },
 "/examples/genjutsu-character/1/in-clip.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 130131,
  "sha256": "a58db65b7b8fc4dce9dc4d43543f5a898a7eea187c7cb9007101babea48ec021",
  "v": "a58db65b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/genjutsu-character/1/in-clip.384.webp?v=7330bcce"
 },
 "/examples/genjutsu-character/1/in-photo1.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4976,
  "sha256": "cf0b29f874fa35dda2b5d75a9511c98f20fd0a6d94b15398b70856f091029086",
  "v": "cf0b29f8",
  "w": 288,
  "h": 384
 },
 "/examples/genjutsu-character/1/in-photo1.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 123959,
  "sha256": "3fdc4cab67154768eb713fd54326513a255cc24952928273fa68f77307a77e03",
  "v": "3fdc4cab",
  "w": 960,
  "h": 1280,
  "thumb": "/examples/genjutsu-character/1/in-photo1.384.webp?v=cf0b29f8"
 },
 "/examples/genjutsu-character/1/in-photo2.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4618,
  "sha256": "d199b904def0bb29a9c51de463133cf46aac892af9054b643723a600f40046a5",
  "v": "d199b904",
  "w": 288,
  "h": 384
 },
 "/examples/genjutsu-character/1/in-photo2.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 103273,
  "sha256": "ece6a208a4ab17f1c254b922ff53a1d356ee9761ba6a4e4ac448a0048aafa3ea",
  "v": "ece6a208",
  "w": 960,
  "h": 1280,
  "thumb": "/examples/genjutsu-character/1/in-photo2.384.webp?v=d199b904"
 },
 "/examples/genjutsu-character/1/show.mp4": {
  "role": "show",
  "type": "video/mp4",
  "bytes": 1109131,
  "sha256": "6d2fb1db6121dae6bf41f8a99bae62432b446750211f863aedc3d565f0cb858a",
  "v": "6d2fb1db",
  "poster": "/examples/genjutsu-character/1/show.poster.webp?v=6639a27c"
 },
 "/examples/genjutsu-character/1/show.peak.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 32068,
  "sha256": "a0a5bb65804309a65094690c2741a0915f4c0bffd940b35ba34518a702a0d0f1",
  "v": "a0a5bb65",
  "w": 512,
  "h": 384
 },
 "/examples/genjutsu-character/1/show.poster.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 73134,
  "sha256": "6639a27ce3efd0d00863b3bd03be3b39b32132233b1889d3bc7840516bc2de03",
  "v": "6639a27c",
  "w": 1024,
  "h": 768
 },
 "/examples/genjutsu-finish/1/in-clip.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22564,
  "sha256": "1d9631ed9ec00dd0ea869293e218cfef72a1ea78a3019a8ba7c6cd830aec6859",
  "v": "1d9631ed",
  "w": 384,
  "h": 288
 },
 "/examples/genjutsu-finish/1/in-clip.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132258,
  "sha256": "052a0f08de9d10ba1c7db6adf383d2a0db0d11ec9eeb3ce001b49e6a5a0e3d08",
  "v": "052a0f08",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/genjutsu-finish/1/in-clip.384.webp?v=1d9631ed"
 },
 "/examples/genjutsu-finish/1/show.mp4": {
  "role": "show",
  "type": "video/mp4",
  "bytes": 994222,
  "sha256": "70fbc6365d6cb3be84d63a6621920297fbbad5a3250f86fac5cee6080a7b1f8b",
  "v": "70fbc636",
  "poster": "/examples/genjutsu-finish/1/show.poster.webp?v=043b6b4f"
 },
 "/examples/genjutsu-finish/1/show.peak.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24276,
  "sha256": "6cec7a2fc3a3af20b7209921a11f5003fe5c35ebab3725af349434d499148228",
  "v": "6cec7a2f",
  "w": 512,
  "h": 384
 },
 "/examples/genjutsu-finish/1/show.poster.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 68274,
  "sha256": "043b6b4f591edadea151604aeac0d83095d04962210ac6278cabdbdae7dd68f8",
  "v": "043b6b4f",
  "w": 1024,
  "h": 768
 },
 "/examples/image/1/out.512.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13540,
  "sha256": "ffb61acb19dbfb0c1507cbea715a3ebd163067543a7c28a5ae9d5d64e5126775",
  "v": "ffb61acb",
  "w": 512,
  "h": 384
 },
 "/examples/image/1/out.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 62594,
  "sha256": "19883be5b92c02b845e88e8603d3231a3aea1ecf16d5ae9e1b41e063e275194d",
  "v": "19883be5",
  "w": 960,
  "h": 720,
  "poster": "/examples/image/1/out.512.webp?v=ffb61acb"
 },
 "/examples/image/2/out.512.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 51780,
  "sha256": "d03715ec2f6a42f612b8f655a2ed14c3f020aae791edf3556ff8218bdffeb075",
  "v": "d03715ec",
  "w": 512,
  "h": 384
 },
 "/examples/image/2/out.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 162391,
  "sha256": "0828b58163b4b93f2527829721fc5fccb872ab5a3dc3ddd9c0f8585a6e3c212e",
  "v": "0828b581",
  "w": 960,
  "h": 720,
  "poster": "/examples/image/2/out.512.webp?v=d03715ec"
 },
 "/examples/image/3/out.512.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16314,
  "sha256": "d6ba3f690026eddc7e54884ecd284e76a2323bf9aa096a1b35b73715ad8ece29",
  "v": "d6ba3f69",
  "w": 512,
  "h": 384
 },
 "/examples/image/3/out.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 68119,
  "sha256": "d5fbd0c8010a0b96a2cfe12eb9df50b27959c8a8ade374f09f18df5d5772b06c",
  "v": "d5fbd0c8",
  "w": 960,
  "h": 720,
  "poster": "/examples/image/3/out.512.webp?v=d6ba3f69"
 },
 "/examples/image/4/out.512.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 43704,
  "sha256": "da6284c3e4de8302e7daad26defcf3e7cd0ff935f0431f5ad90dfeb15f774cd3",
  "v": "da6284c3",
  "w": 512,
  "h": 384
 },
 "/examples/image/4/out.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 131388,
  "sha256": "e0b49ad9856cb9fdf2c01ef315803607d30fcf6f8e3fc973ba542656ed26b001",
  "v": "e0b49ad9",
  "w": 960,
  "h": 720,
  "poster": "/examples/image/4/out.512.webp?v=da6284c3"
 },
 "/examples/inpaint/1/in-mask.png": {
  "role": "in",
  "type": "image/png",
  "bytes": 5056,
  "sha256": "c9e37e77fcaceb55b93ab12e2306351e7eaaa00f164ee45e15c91811e502c55e",
  "v": "c9e37e77",
  "w": 1280,
  "h": 960
 },
 "/examples/inpaint/1/in-sketch.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16988,
  "sha256": "b752edec071dfa4b879434deb80dfbffdef2ced221be0d1bdcb7b1560592c143",
  "v": "b752edec",
  "w": 384,
  "h": 288
 },
 "/examples/inpaint/1/in-sketch.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 143541,
  "sha256": "5d23bc9a1226e2a2ca869fa8ecf2d9ae64982f67aa2b0c7cbc6a501569b4abdd",
  "v": "5d23bc9a",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/inpaint/1/in-sketch.384.webp?v=b752edec"
 },
 "/examples/inpaint/2/in-mask.png": {
  "role": "in",
  "type": "image/png",
  "bytes": 4351,
  "sha256": "066f6150e14e0adf9f117ad86f61b764a9d66d86d337eb8b334d90f422ac4e77",
  "v": "066f6150",
  "w": 1280,
  "h": 960
 },
 "/examples/inpaint/2/in-sketch.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21072,
  "sha256": "ae4d66bd8473efd45753bc582a55a5dd5122acd0390de33818493be2dc3d9f51",
  "v": "ae4d66bd",
  "w": 384,
  "h": 288
 },
 "/examples/inpaint/2/in-sketch.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 195844,
  "sha256": "99413080b9e7664797b3bb4768e1206b34d8b22cd92f8437c927b24df78f09c5",
  "v": "99413080",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/inpaint/2/in-sketch.384.webp?v=ae4d66bd"
 },
 "/examples/inpaint/3/in-mask.png": {
  "role": "in",
  "type": "image/png",
  "bytes": 7242,
  "sha256": "32c7dcdbe26c24896cb872f2f2a6fcec38109931b227876ce33187695ce772be",
  "v": "32c7dcdb",
  "w": 1280,
  "h": 960
 },
 "/examples/inpaint/3/in-sketch.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4974,
  "sha256": "42c56be8641e551e810acbb9c13accfc32a6c7d562908117a582ae4a40650a13",
  "v": "42c56be8",
  "w": 384,
  "h": 288
 },
 "/examples/inpaint/3/in-sketch.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83387,
  "sha256": "8a0cfd7724262521e2c91d71d3a186b8409c142cbbf965635fd788321177d07c",
  "v": "8a0cfd77",
  "w": 1280,
  "h": 960,
  "thumb": "/examples/inpaint/3/in-sketch.384.webp?v=42c56be8"
 },
 "/examples/motion-3d-rotation/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 4178,
  "sha256": "e8286fa2bc173225265dfcee9faa465a22dd978da002fac2fd32aa81695ad138",
  "v": "e8286fa2",
  "w": 384,
  "h": 288
 },
 "/examples/motion-3d-rotation/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 41780,
  "sha256": "3ddfa4c44b65f133df38264cb17afa9f718cdcc21d369d5bb2b31438a5bf745d",
  "v": "3ddfa4c4",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-3d-rotation/1/in-image.384.webp?v=e8286fa2"
 },
 "/examples/motion-3d-rotation/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 8442,
  "sha256": "697679061fc51e556e14393ea2b650717b2bda7a746029ffa62fd703f91f7b07",
  "v": "69767906",
  "w": 512,
  "h": 384
 },
 "/examples/motion-action-run/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 33992,
  "sha256": "0f677608d0567e678dcd983e5078dba3f628ea327de86e53d163a4554584ef36",
  "v": "0f677608",
  "w": 384,
  "h": 288
 },
 "/examples/motion-action-run/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 199079,
  "sha256": "7e51903c4c7f8b0cd34eedb944b3b60de5130bd15be2a586213731457b072827",
  "v": "7e51903c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-action-run/1/in-image.384.webp?v=0f677608"
 },
 "/examples/motion-action-run/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 43611,
  "sha256": "d4822533450ecc67733455bb5059c7d1b1daed3a81b6ec9e35c1221b88d2105b",
  "v": "d4822533",
  "w": 512,
  "h": 384
 },
 "/examples/motion-aerial-pullback/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23100,
  "sha256": "4a30687014589883cd2284cbc7d10c9ec3cade42d49c643f44b476dfa8619e59",
  "v": "4a306870",
  "w": 384,
  "h": 288
 },
 "/examples/motion-aerial-pullback/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 166733,
  "sha256": "e4b75b29d7a43a588ee1e529b207bd5f1a161717b417056d518891ec7f0777ad",
  "v": "e4b75b29",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-aerial-pullback/1/in-image.384.webp?v=4a306870"
 },
 "/examples/motion-aerial-pullback/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31586,
  "sha256": "04a3adb281a67ddda477b4787d197c05de4dd2e6c84b9f731060a97f57d8becc",
  "v": "04a3adb2",
  "w": 512,
  "h": 384
 },
 "/examples/motion-arc-left/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20128,
  "sha256": "5524b43c56999aaa1d30528a41b3121a5468a9de5b33fd4280b2e761cdd4fcdf",
  "v": "5524b43c",
  "w": 384,
  "h": 288
 },
 "/examples/motion-arc-left/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 148772,
  "sha256": "cb312dbedb6fc7ae6a507d80d6d35f1d434562bd35c9d741e9813589bd157daa",
  "v": "cb312dbe",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-arc-left/1/in-image.384.webp?v=5524b43c"
 },
 "/examples/motion-arc-left/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29105,
  "sha256": "bca1805d172d03dfe62ab3450875cf992783347253e8696aab79efe547ce9080",
  "v": "bca1805d",
  "w": 512,
  "h": 384
 },
 "/examples/motion-arc-right/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18878,
  "sha256": "ceff05026e7c9fc164fe66295111c8c5480dedbef52759a5fabc2218d6676743",
  "v": "ceff0502",
  "w": 384,
  "h": 288
 },
 "/examples/motion-arc-right/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 137383,
  "sha256": "cb7c71006a224fe1c5ae6375474ed273114295ba2e2b8564edd1a5d99c26f612",
  "v": "cb7c7100",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-arc-right/1/in-image.384.webp?v=ceff0502"
 },
 "/examples/motion-arc-right/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27622,
  "sha256": "29c212219d52e080f1a6567b538e0006221294d6614db5247ec3b6c042166e4d",
  "v": "29c21221",
  "w": 512,
  "h": 384
 },
 "/examples/motion-baseball-kick/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20738,
  "sha256": "2bc7cac9415887db22a733b3b6bcb21d82b38bc775f4fb1403ed3c310e7d86c2",
  "v": "2bc7cac9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-baseball-kick/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 133429,
  "sha256": "cf9d1b28bba43f31c8322d606e8230de54947132b24cc317e673f49aa43b50f4",
  "v": "cf9d1b28",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-baseball-kick/1/in-image.384.webp?v=2bc7cac9"
 },
 "/examples/motion-baseball-kick/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 35250,
  "sha256": "19ef9d564c7fb1cf778d76f57c68de3a89384b65abb63a8afbf7f2b031e07867",
  "v": "19ef9d56",
  "w": 512,
  "h": 384
 },
 "/examples/motion-basketball-dunks/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12860,
  "sha256": "2eb73510872b8ce0c98dc91e01adfd2f2cae26174956465da552cf0dcf11a491",
  "v": "2eb73510",
  "w": 384,
  "h": 288
 },
 "/examples/motion-basketball-dunks/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108032,
  "sha256": "df2577e0f0529ed1add1e2f54be145bc15187c387cf1ef24bce6fbb750eef311",
  "v": "df2577e0",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-basketball-dunks/1/in-image.384.webp?v=2eb73510"
 },
 "/examples/motion-basketball-dunks/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24417,
  "sha256": "30c6e624d871cfe5e385d226ad01509a181ed51573ecf839ef3086d879775d09",
  "v": "30c6e624",
  "w": 512,
  "h": 384
 },
 "/examples/motion-boxing/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11026,
  "sha256": "77c5098bd45f307766901594e48c347e7f0b323969bf0f09b45f928c0bb84942",
  "v": "77c5098b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-boxing/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 80597,
  "sha256": "c19ea0a736db55d7c741cdb483211131702f9db4c79a5a5594189dfc9e009adf",
  "v": "c19ea0a7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-boxing/1/in-image.384.webp?v=77c5098b"
 },
 "/examples/motion-boxing/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22276,
  "sha256": "c31ffe44be1e659885ca8c285268c60c6499136467f6a02731ba884361d9b21d",
  "v": "c31ffe44",
  "w": 512,
  "h": 384
 },
 "/examples/motion-bts/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14078,
  "sha256": "f162bb1790904b0bf8136ca45d4812b81b2f13333371fb6f35b25c11616f1f2a",
  "v": "f162bb17",
  "w": 384,
  "h": 288
 },
 "/examples/motion-bts/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 93818,
  "sha256": "afa0f7cd4003a2bac92e8a7ba60f95c8009c38d602b09298d752b9c6c5d5d48a",
  "v": "afa0f7cd",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-bts/1/in-image.384.webp?v=f162bb17"
 },
 "/examples/motion-bts/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29303,
  "sha256": "c167073a101d7c3d037021caed19ecc578a6c8b69c170832fb09a04a559156f1",
  "v": "c167073a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-buckle-up/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25754,
  "sha256": "01da28b0c1c1f3be43b8932f024c9181d9df0fd58042a40a600619553e63d476",
  "v": "01da28b0",
  "w": 384,
  "h": 288
 },
 "/examples/motion-buckle-up/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164318,
  "sha256": "c55ae97e9a2647ac21609e6866cf23613d2b1e1824c7ac0a6ab10106e75b6cae",
  "v": "c55ae97e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-buckle-up/1/in-image.384.webp?v=01da28b0"
 },
 "/examples/motion-buckle-up/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30181,
  "sha256": "ee3ab42b1668b88eaf5ed46cf8d6ac4ae1f88165b81ef26416448e15559b27c5",
  "v": "ee3ab42b",
  "w": 512,
  "h": 384
 },
 "/examples/motion-car-chasing/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11614,
  "sha256": "08484079aae9a1d73ebe676fe5848a97434ffc600b7707c5fb2b312324e07ddd",
  "v": "08484079",
  "w": 384,
  "h": 288
 },
 "/examples/motion-car-chasing/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 93717,
  "sha256": "aa21df86147163e83d4ff6c1cc9fb5cc2af8e198ae13df14832eed1c0c07ceab",
  "v": "aa21df86",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-car-chasing/1/in-image.384.webp?v=08484079"
 },
 "/examples/motion-car-chasing/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21692,
  "sha256": "3fbc5978c06d584c30ae738a76fa6ebef0f6c4a58414840efeda9d9ed0948183",
  "v": "3fbc5978",
  "w": 512,
  "h": 384
 },
 "/examples/motion-car-grip/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18656,
  "sha256": "524511dbd972e78fcc61e32399ab35a28a4ca1bf7b24e24d2732d6d1697ad9a4",
  "v": "524511db",
  "w": 384,
  "h": 288
 },
 "/examples/motion-car-grip/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115526,
  "sha256": "3ddda61a76a945bc79f64c684b527ec6e7ae3fe3af12d5aec120220f53797d7d",
  "v": "3ddda61a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-car-grip/1/in-image.384.webp?v=524511db"
 },
 "/examples/motion-car-grip/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27610,
  "sha256": "2810de85de359ad5a9fff6ab30f24f324f4a26dc8c8e8d5ed4d9e9cd7f72c63f",
  "v": "2810de85",
  "w": 512,
  "h": 384
 },
 "/examples/motion-catwalk/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 28334,
  "sha256": "e3502de86cbd014c8e4dab7d6927d7895dbd354d566127ac3624347f4f401503",
  "v": "e3502de8",
  "w": 384,
  "h": 288
 },
 "/examples/motion-catwalk/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 166631,
  "sha256": "bffdd9674febf76bab1d11dc5fc0baf79e4abe51de3113eea76502b03858da0d",
  "v": "bffdd967",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-catwalk/1/in-image.384.webp?v=e3502de8"
 },
 "/examples/motion-catwalk/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39918,
  "sha256": "547452850ac93f2b8a8b7efc944ce34d6c1cf9a0e1e3c60fd10e2549a56903ce",
  "v": "54745285",
  "w": 512,
  "h": 384
 },
 "/examples/motion-classic-static/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19882,
  "sha256": "a21ea01442ef62c6f431244efc85d6691946304967f724f5a6026b565e3f8752",
  "v": "a21ea014",
  "w": 384,
  "h": 288
 },
 "/examples/motion-classic-static/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 138609,
  "sha256": "25024b550801004c274e41ddf9b3fcf0486aff53197b8a4c6af0000179635686",
  "v": "25024b55",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-classic-static/1/in-image.384.webp?v=a21ea014"
 },
 "/examples/motion-classic-static/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38988,
  "sha256": "3a20fdd500e0cc029e7431d152a5a2c5bede6eb2b815bcb11f01c62d88689f29",
  "v": "3a20fdd5",
  "w": 512,
  "h": 384
 },
 "/examples/motion-crane-down/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27702,
  "sha256": "2ca90e95ca037025d4ed934f065e46aa20180d1fb1f630fbade1a9043c7bff27",
  "v": "2ca90e95",
  "w": 384,
  "h": 288
 },
 "/examples/motion-crane-down/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 183521,
  "sha256": "f7d063f940a3ecf48acd44ea57c9f01865a002ed7f4b199a0cc2f88b8e595234",
  "v": "f7d063f9",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-crane-down/1/in-image.384.webp?v=2ca90e95"
 },
 "/examples/motion-crane-down/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 41536,
  "sha256": "4a5d294320386fbaedc9feaaeeb79488be1a0b23f945c6fa6a4b9fba5dcbcefe",
  "v": "4a5d2943",
  "w": 512,
  "h": 384
 },
 "/examples/motion-crane-over-the-head/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18868,
  "sha256": "883b574b4af4410122efff1bd493b5a41eb19d575cbc6af83be89a86d4584e00",
  "v": "883b574b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-crane-over-the-head/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126344,
  "sha256": "e64c9478c12b2954eb1817b43bcb5aae9abd38418e1a50aabe9e2b59c4ec093f",
  "v": "e64c9478",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-crane-over-the-head/1/in-image.384.webp?v=883b574b"
 },
 "/examples/motion-crane-over-the-head/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24400,
  "sha256": "9f2154239089ff337595f0d67314aaa00adff02d5c25f6fcd700db0f8b435f78",
  "v": "9f215423",
  "w": 512,
  "h": 384
 },
 "/examples/motion-crane-up/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9556,
  "sha256": "8968d61b83627e7624a533804d3fee676e2bd28e9d34330a6ff3be98990ddcb8",
  "v": "8968d61b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-crane-up/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 84836,
  "sha256": "7ce6b8a252d5c56f3d0c28a0c42e337341c10cc749a4b123587e9346c2bb8f61",
  "v": "7ce6b8a2",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-crane-up/1/in-image.384.webp?v=8968d61b"
 },
 "/examples/motion-crane-up/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 16895,
  "sha256": "c9d2633e2f204e6bb151a96c3bf6bd7eaa90ecb83730678e58cd62bdd2b1a106",
  "v": "c9d2633e",
  "w": 512,
  "h": 384
 },
 "/examples/motion-documentary-snap/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11104,
  "sha256": "15965e555c167d1a20494f37bc94a4a2ce39a7367da855b9c6e4c92648a96d1f",
  "v": "15965e55",
  "w": 384,
  "h": 288
 },
 "/examples/motion-documentary-snap/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 90431,
  "sha256": "b714dbf101e2b0beddc3cca54db8cc4a2ab25a653da6440e16c21ffeee87ff11",
  "v": "b714dbf1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-documentary-snap/1/in-image.384.webp?v=15965e55"
 },
 "/examples/motion-documentary-snap/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 9262,
  "sha256": "4cb1e5e4199b6162ad55540c5433c3db9f4694f48fa5bd776166c4c1413b0a7e",
  "v": "4cb1e5e4",
  "w": 512,
  "h": 384
 },
 "/examples/motion-dolly-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 30832,
  "sha256": "1c5d45e9199a46e37884f24f5efdeddf41eb39d16e1ac2b1116d689054ce166c",
  "v": "1c5d45e9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-dolly-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 194865,
  "sha256": "010fe9562f50acdcb6e2fb3381a1747adda83de2c12cd582bc3055e2ef2d4a13",
  "v": "010fe956",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-dolly-in/1/in-image.384.webp?v=1c5d45e9"
 },
 "/examples/motion-dolly-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 44758,
  "sha256": "58c3042cab9c4f3e72e5fbc302d807f195162e9a166c9c1782be49f0880852aa",
  "v": "58c3042c",
  "w": 512,
  "h": 384
 },
 "/examples/motion-dolly-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20924,
  "sha256": "f86ac645ca6aeff92a89f61dd82a92e5d9629d746c16b1787491aa7bad364b94",
  "v": "f86ac645",
  "w": 384,
  "h": 288
 },
 "/examples/motion-dolly-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 140033,
  "sha256": "d8475997776963891bf8136307e2cc86a63d53e78d1c39c7e0afd84559d089aa",
  "v": "d8475997",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-dolly-out/1/in-image.384.webp?v=f86ac645"
 },
 "/examples/motion-dolly-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38208,
  "sha256": "c60dec8721876ef17bfe3e65cf870dc93490f8dd61a6636ee84ae95d22a7362e",
  "v": "c60dec87",
  "w": 512,
  "h": 384
 },
 "/examples/motion-double-dolly/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24034,
  "sha256": "4708f132459bccadbb4fac28587fd6755865cbfbbe00203b89cef49a484e7281",
  "v": "4708f132",
  "w": 384,
  "h": 288
 },
 "/examples/motion-double-dolly/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 150922,
  "sha256": "0a82e6837449c6302caef99d013057270de279a92cc59bb6fc4a2116c85fffcd",
  "v": "0a82e683",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-double-dolly/1/in-image.384.webp?v=4708f132"
 },
 "/examples/motion-double-dolly/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 35711,
  "sha256": "8509f6410a637b705e21bcac3f995523cf04e930d0c1743a129f7cbb6f08d9d6",
  "v": "8509f641",
  "w": 512,
  "h": 384
 },
 "/examples/motion-downhill-pov/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24194,
  "sha256": "fc2ef4ad073869980b9ccf7a59f528645c2ec112563c155d282b0bebefeb595b",
  "v": "fc2ef4ad",
  "w": 384,
  "h": 288
 },
 "/examples/motion-downhill-pov/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 173891,
  "sha256": "ce02257b5a27f603c610e5093cabdb605794ad05168b88e9951b26c2d1147fb9",
  "v": "ce02257b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-downhill-pov/1/in-image.384.webp?v=fc2ef4ad"
 },
 "/examples/motion-downhill-pov/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30870,
  "sha256": "cca264761bf885ba7b70670e76277b8b80e90c4971c1cccb5e11d3272c5edc4f",
  "v": "cca26476",
  "w": 512,
  "h": 384
 },
 "/examples/motion-dreamy-flow/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18806,
  "sha256": "21a0d23f5f962fea989f531e6f828489704722abbd54608281fc7e97ae740346",
  "v": "21a0d23f",
  "w": 384,
  "h": 288
 },
 "/examples/motion-dreamy-flow/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126204,
  "sha256": "0f20d27b798828dbc2f57044417bcaec8480655560f398902e5e1c4ee2fde121",
  "v": "0f20d27b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-dreamy-flow/1/in-image.384.webp?v=21a0d23f"
 },
 "/examples/motion-dreamy-flow/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 19839,
  "sha256": "423b694b193b3a92bb7030d9a41bd64641b344c42963e3f315eeaa731fd5cc98",
  "v": "423b694b",
  "w": 512,
  "h": 384
 },
 "/examples/motion-drone-reveal/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21272,
  "sha256": "d4310de7845fd0b5c865eae71dc2c8a7e7b02d71d123364ca8e1df14e515a20c",
  "v": "d4310de7",
  "w": 384,
  "h": 288
 },
 "/examples/motion-drone-reveal/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 157234,
  "sha256": "00a6bb81805d1a88c74e651d1d75767245fbb1f2a831597df25d88fc5b5ac6f8",
  "v": "00a6bb81",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-drone-reveal/1/in-image.384.webp?v=d4310de7"
 },
 "/examples/motion-drone-reveal/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21430,
  "sha256": "e300190be17c7dce8a88aee605bcc416862293c9c4f5c958dc925b70468a3b61",
  "v": "e300190b",
  "w": 512,
  "h": 384
 },
 "/examples/motion-dutch-angle/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23698,
  "sha256": "474004f5f603c7c524145aa86f7a74fcaa85f65a8dfd313ece174870342dea0d",
  "v": "474004f5",
  "w": 384,
  "h": 288
 },
 "/examples/motion-dutch-angle/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 147967,
  "sha256": "24f824eb5176003ddf606f540e5e43429a7248a554f81b585e124cd883fed13c",
  "v": "24f824eb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-dutch-angle/1/in-image.384.webp?v=474004f5"
 },
 "/examples/motion-dutch-angle/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39047,
  "sha256": "6ae6230c23fcafa4e7625727c87d547b885bf6317a1cbb1358cd1f4bf385d98d",
  "v": "6ae6230c",
  "w": 512,
  "h": 384
 },
 "/examples/motion-earth-zoom-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25308,
  "sha256": "34e07e4e0e0327daa31a5ae1cdad00db4513335334bb3f017cfe66e9526f6ecf",
  "v": "34e07e4e",
  "w": 384,
  "h": 288
 },
 "/examples/motion-earth-zoom-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 167138,
  "sha256": "74729d02fc0d58616bff1de71caf07a616ebf2336df4e6b156fb35901892685e",
  "v": "74729d02",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-earth-zoom-out/1/in-image.384.webp?v=34e07e4e"
 },
 "/examples/motion-earth-zoom-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 28423,
  "sha256": "4138d21f167ad3a64f4100d09baef28f115b7d2edc95967cc6f6945114f88e3b",
  "v": "4138d21f",
  "w": 512,
  "h": 384
 },
 "/examples/motion-eating-zoom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16800,
  "sha256": "6c46485a66f3bcf8a26a7e4beb4e237185f5612463c77dfa4a6fd3480849b025",
  "v": "6c46485a",
  "w": 384,
  "h": 288
 },
 "/examples/motion-eating-zoom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 108505,
  "sha256": "53a0f6c362e3577d2e8700792af6ef6a5c5196c45fc16b0fddd756dc79dae8ce",
  "v": "53a0f6c3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-eating-zoom/1/in-image.384.webp?v=6c46485a"
 },
 "/examples/motion-epic-scale/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14838,
  "sha256": "8796717b32c8a3833e7b6420538a9e20cafe7e4c3475063df7e8b04b5ed74392",
  "v": "8796717b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-epic-scale/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 107847,
  "sha256": "60893301344a6399443022c5fbfa959620e40a155cc5ba74f5a335bd1af7d66d",
  "v": "60893301",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-epic-scale/1/in-image.384.webp?v=8796717b"
 },
 "/examples/motion-epic-scale/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 28352,
  "sha256": "af50488ac5f483d8f28e8a0e6da58c092f9b767cc49bb9dc6a59d7b031683bb7",
  "v": "af50488a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-eyes-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20210,
  "sha256": "3f63f894987e129f44ff87430b85447aff20021a522437f439a9cfeaf89e1ab9",
  "v": "3f63f894",
  "w": 384,
  "h": 288
 },
 "/examples/motion-eyes-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 150112,
  "sha256": "e8780a5bf3c23d327b444d933a471ae701b997b04e38f76f73c22a84a5b4368b",
  "v": "e8780a5b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-eyes-in/1/in-image.384.webp?v=3f63f894"
 },
 "/examples/motion-eyes-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 38685,
  "sha256": "5a99dbe94ba453447acbff1adb70d7b24660ac982d495923014f1d0e29f738b6",
  "v": "5a99dbe9",
  "w": 512,
  "h": 384
 },
 "/examples/motion-face-punch/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 5530,
  "sha256": "eacb1a312bb11f652e12d63f438d54ee6bece0c6addc4c3be6dafd29acf4b075",
  "v": "eacb1a31",
  "w": 384,
  "h": 288
 },
 "/examples/motion-face-punch/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 60201,
  "sha256": "3b8cb82a17c4accdffa139efc36ce2e8b129d35b6238bc1957dcb9932e937e14",
  "v": "3b8cb82a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-face-punch/1/in-image.384.webp?v=eacb1a31"
 },
 "/examples/motion-face-punch/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 14961,
  "sha256": "1b23c1ad9ebd9cf62fcf4d2f568316ac5bbf3a6568226b288312f9a20f779781",
  "v": "1b23c1ad",
  "w": 512,
  "h": 384
 },
 "/examples/motion-flying-cam-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9612,
  "sha256": "d6ae1f924bf4100e35010ce5cfe707e730a42b5aeda1c8699465f0a05e91d31d",
  "v": "d6ae1f92",
  "w": 384,
  "h": 288
 },
 "/examples/motion-flying-cam-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 82166,
  "sha256": "57ebe5dc09cfc5d8b1f4131149af1c7fa9a56f852e3747c73408f45b8fca7960",
  "v": "57ebe5dc",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-flying-cam-transition/1/in-image.384.webp?v=d6ae1f92"
 },
 "/examples/motion-flying-cam-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 10109,
  "sha256": "ff2d1a4beebe96fc01b77c3f634d841abc0aa8834533309b9f30c0f494cfdff6",
  "v": "ff2d1a4b",
  "w": 512,
  "h": 384
 },
 "/examples/motion-flying/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16342,
  "sha256": "10beaaee0eb9e2c69a79de820200ca787f86bb2060e7ed724168d170b3ac72e4",
  "v": "10beaaee",
  "w": 384,
  "h": 288
 },
 "/examples/motion-flying/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 118731,
  "sha256": "4f68533eacb9d37bd71d0061076f999852b65783757b1597b9c2d071d958c267",
  "v": "4f68533e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-flying/1/in-image.384.webp?v=10beaaee"
 },
 "/examples/motion-flying/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25979,
  "sha256": "ccc58d67e92cd8eefc648190a55082c0f7e4a402c865e1099359de722be1a7e7",
  "v": "ccc58d67",
  "w": 512,
  "h": 384
 },
 "/examples/motion-general/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 12894,
  "sha256": "748d3fe52def12ff58d50d8c06320d6cb9bc170f88464d4889fd1fdd7ca49635",
  "v": "748d3fe5",
  "w": 384,
  "h": 288
 },
 "/examples/motion-general/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 102588,
  "sha256": "0ed31873de373adc70a337476bbc193f5fd46e824c9618029d6674578a1c35b7",
  "v": "0ed31873",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-general/1/in-image.384.webp?v=748d3fe5"
 },
 "/examples/motion-general/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 22980,
  "sha256": "da0adf704c3fd080cf0b5b6a9187e398ab94b647501e1e33ebecb0ae26d387a6",
  "v": "da0adf70",
  "w": 512,
  "h": 384
 },
 "/examples/motion-glam/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25834,
  "sha256": "90b3d6638aecbb785c49e247078eb1b68991daaef9ff093b0d7650a2e99e7569",
  "v": "90b3d663",
  "w": 384,
  "h": 288
 },
 "/examples/motion-glam/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 158234,
  "sha256": "3eefd257f17527bba6c58f174e974515d9d163062d421158d2ce5caccafb8e83",
  "v": "3eefd257",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-glam/1/in-image.384.webp?v=90b3d663"
 },
 "/examples/motion-glam/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21236,
  "sha256": "caa569aba4c7e1dddda7c1b6da0e2e5fca0af11b190b37cffde73b6a3edfb802",
  "v": "caa569ab",
  "w": 512,
  "h": 384
 },
 "/examples/motion-handheld/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17476,
  "sha256": "9c08ce723c43fedf9db0889c3717874c0a65d1446df08e59e26a581bfa83a1bd",
  "v": "9c08ce72",
  "w": 384,
  "h": 288
 },
 "/examples/motion-handheld/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114491,
  "sha256": "7b5e27349b275f4dc034c24f8815b04d3307bd9678d7d9df12fe6120196a389f",
  "v": "7b5e2734",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-handheld/1/in-image.384.webp?v=9c08ce72"
 },
 "/examples/motion-handheld/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 29436,
  "sha256": "b105491f414a4b967a40abcfe642bc811c26d174c45c1182fc742c074edbd022",
  "v": "b105491f",
  "w": 512,
  "h": 384
 },
 "/examples/motion-head-tracking/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19046,
  "sha256": "c5315ceee25a69361eb1f6eaf37ffbe92fe05b3be30c8a7f101e4c0cf09406f9",
  "v": "c5315cee",
  "w": 384,
  "h": 288
 },
 "/examples/motion-head-tracking/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 116341,
  "sha256": "0c34d0103f778ac3fc24c83ad2442a69aa4c457bd36737d3cedba62bc25405ae",
  "v": "0c34d010",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-head-tracking/1/in-image.384.webp?v=c5315cee"
 },
 "/examples/motion-head-tracking/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33872,
  "sha256": "1ea8b2eca17918464ab8da9c0b713ee0a96f616677d4c853e556ce664e9f1ab1",
  "v": "1ea8b2ec",
  "w": 512,
  "h": 384
 },
 "/examples/motion-helicopter-shot/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15734,
  "sha256": "13c753fa11bb35478bb7ed4fe934438d49193104c9530a99064e9d641bb4b1d9",
  "v": "13c753fa",
  "w": 384,
  "h": 288
 },
 "/examples/motion-helicopter-shot/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 125874,
  "sha256": "e54762feb01dec0443cf77e596fcd6a789869ee55f1dece7120a1e30b3c68135",
  "v": "e54762fe",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-helicopter-shot/1/in-image.384.webp?v=13c753fa"
 },
 "/examples/motion-helicopter-shot/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36536,
  "sha256": "6fdb9618c84fe26c6db8a9749be55818b3856b45c9d87757eec80d0126444c10",
  "v": "6fdb9618",
  "w": 512,
  "h": 384
 },
 "/examples/motion-hyperlapse/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27604,
  "sha256": "c9fe3d0dbcc8eadd6b6319f40fd442a4f7ff79f3adc29725f237d3c07af16138",
  "v": "c9fe3d0d",
  "w": 384,
  "h": 288
 },
 "/examples/motion-hyperlapse/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 191067,
  "sha256": "31d47af717e28150c2d24bdfd4c8d1a0bfe9ab7b4b6fe8a647a58b353948b682",
  "v": "31d47af7",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-hyperlapse/1/in-image.384.webp?v=c9fe3d0d"
 },
 "/examples/motion-hyperlapse/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 40632,
  "sha256": "70d48a1a77419bdaaeed583662c221dbefa649671753af1f448680ca86b7bfda",
  "v": "70d48a1a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-impossible-camera/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17772,
  "sha256": "d52ef784dd848618b9dd001ecf2cf13c35318e0362fd097e5c74c76349bd35f4",
  "v": "d52ef784",
  "w": 384,
  "h": 288
 },
 "/examples/motion-impossible-camera/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115619,
  "sha256": "301fdd2b1863558d1cd9bee0d63cb49b226352ff668d2d6666661b44e265e036",
  "v": "301fdd2b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-impossible-camera/1/in-image.384.webp?v=d52ef784"
 },
 "/examples/motion-impossible-camera/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 12419,
  "sha256": "3524db4e806bf580c5403da947d2ed6316208a1ac0cc1225d0bf5eb692065ad8",
  "v": "3524db4e",
  "w": 512,
  "h": 384
 },
 "/examples/motion-incline/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15266,
  "sha256": "291ca5c84c3916d10905d5872e2612d69eb396c0af199f24725021f0755160e1",
  "v": "291ca5c8",
  "w": 384,
  "h": 288
 },
 "/examples/motion-incline/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 120621,
  "sha256": "561db8ef842f2416c27e4df1d8650c8ca70161f32bc54b3a021b71dc8f8178e0",
  "v": "561db8ef",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-incline/1/in-image.384.webp?v=291ca5c8"
 },
 "/examples/motion-incline/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39932,
  "sha256": "07ad437086888ebcbd36acb4aae71c46f77c51880bcc430b6f41f3be818c64f2",
  "v": "07ad4370",
  "w": 512,
  "h": 384
 },
 "/examples/motion-intimate-observer/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8782,
  "sha256": "e75e2f6892a738684a7faee34e920eb3c377e761ac6834421266fbf023f59b2e",
  "v": "e75e2f68",
  "w": 384,
  "h": 288
 },
 "/examples/motion-intimate-observer/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 71884,
  "sha256": "a5a790882c3d3f95b0d35a88e3d41f9dc8c13766c5ad77bfa7004dd2b5c6618e",
  "v": "a5a79088",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-intimate-observer/1/in-image.384.webp?v=e75e2f68"
 },
 "/examples/motion-intimate-observer/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 18502,
  "sha256": "5a21ab887535750c4c557e1852686bc6605cce04692ea80cefc2cb41b36c6aa8",
  "v": "5a21ab88",
  "w": 512,
  "h": 384
 },
 "/examples/motion-jib-down/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24846,
  "sha256": "5feac159a4ae35ff0c87334b1b04c68da9278fb0ee15c433c7395d5680775ea7",
  "v": "5feac159",
  "w": 384,
  "h": 288
 },
 "/examples/motion-jib-down/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164870,
  "sha256": "942a9af3dc241f31935a4f37aed6e3d0629c5537acf1056a5d50f36a97408fd8",
  "v": "942a9af3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-jib-down/1/in-image.384.webp?v=5feac159"
 },
 "/examples/motion-jib-down/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 42054,
  "sha256": "be597a041222f55d912bcb75b2775805fba9ac37d918ac574dfde56500a95694",
  "v": "be597a04",
  "w": 512,
  "h": 384
 },
 "/examples/motion-jib-up/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 11006,
  "sha256": "06dfbc80a17ca80416f269989fff7bcc9bb3c78c0974a309ce6a16d22a00e4a8",
  "v": "06dfbc80",
  "w": 384,
  "h": 288
 },
 "/examples/motion-jib-up/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 92731,
  "sha256": "d432de34448367b9240338f403503f83f766bfb250ae7ff6ce03fae9e351e899",
  "v": "d432de34",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-jib-up/1/in-image.384.webp?v=06dfbc80"
 },
 "/examples/motion-jib-up/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 30406,
  "sha256": "a82631749e9c2fa43ca2cdb39633a63a3ef4166982f3129589805445438d7b0e",
  "v": "a8263174",
  "w": 512,
  "h": 384
 },
 "/examples/motion-kiss/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13558,
  "sha256": "c90bd4880b4bd45e1f6b71a962e6ed1981512debdf311c979e1e21918405c8d2",
  "v": "c90bd488",
  "w": 384,
  "h": 288
 },
 "/examples/motion-kiss/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 94260,
  "sha256": "e7a4d98db7e1192a01bdc84267ea81ac110a91232286979c48773c0850dcac9f",
  "v": "e7a4d98d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-kiss/1/in-image.384.webp?v=c90bd488"
 },
 "/examples/motion-kiss/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25350,
  "sha256": "9cb266333fadc815a426236e20c9492607b7422b3f83c8fb27b3aac41fece0f6",
  "v": "9cb26633",
  "w": 512,
  "h": 384
 },
 "/examples/motion-lazy-orbit/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15184,
  "sha256": "db04544ca26475368d6e03b4a803537cefccd8628ee4d44979d81af6ff7ca277",
  "v": "db04544c",
  "w": 384,
  "h": 288
 },
 "/examples/motion-lazy-orbit/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 102277,
  "sha256": "47c41b33bcd5df821bdfc3e12fe42b2c57ad3d0d8a5540371f8d8c36c0fc4b73",
  "v": "47c41b33",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-lazy-orbit/1/in-image.384.webp?v=db04544c"
 },
 "/examples/motion-lazy-orbit/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25316,
  "sha256": "0ee209255a2e33429295cf58f2e2ceecf17a0b050b88c26d3da31e519ebb433e",
  "v": "0ee20925",
  "w": 512,
  "h": 384
 },
 "/examples/motion-lazy-susan/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 26332,
  "sha256": "c998b7ed6159c414409eefa45cdae7b851f73aa3a216c79a5a0a948f29c762e7",
  "v": "c998b7ed",
  "w": 384,
  "h": 288
 },
 "/examples/motion-lazy-susan/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 182804,
  "sha256": "cd5b5760dbd05140630d328f32bc93d36d4e40889a95d86e95806422c3cbc5f7",
  "v": "cd5b5760",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-lazy-susan/1/in-image.384.webp?v=c998b7ed"
 },
 "/examples/motion-lazy-susan/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 48907,
  "sha256": "064eec5f2d5026ff73aa9d8e4de957d5b1f9b463485319ea3a3c302f66fac851",
  "v": "064eec5f",
  "w": 512,
  "h": 384
 },
 "/examples/motion-low-shutter/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 25726,
  "sha256": "81c59aa0a6ce4586d5d1c2f5ebf49363f9568f54055793dc6a9d4a24f2866035",
  "v": "81c59aa0",
  "w": 384,
  "h": 288
 },
 "/examples/motion-low-shutter/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 164171,
  "sha256": "a63635c5c6a443c54be0fa9c5a3651a36ba4c2259ab83a1b197045f1e6aca9e9",
  "v": "a63635c5",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-low-shutter/1/in-image.384.webp?v=81c59aa0"
 },
 "/examples/motion-low-shutter/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 35583,
  "sha256": "0bc02efcc4e5132a1e239de58ec505ff55178aa32084e945435ce5b42143110e",
  "v": "0bc02efc",
  "w": 512,
  "h": 384
 },
 "/examples/motion-mouth-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13850,
  "sha256": "bedd54b698defdc4fecdb8687f86512e6e19847affcb32b14c3377b4835e8204",
  "v": "bedd54b6",
  "w": 384,
  "h": 288
 },
 "/examples/motion-mouth-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 101865,
  "sha256": "c5b4d0869f538f47b96c77f8cd948ea2f27162d272f9059c1268a5ebee2c13c1",
  "v": "c5b4d086",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-mouth-in/1/in-image.384.webp?v=bedd54b6"
 },
 "/examples/motion-mouth-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24631,
  "sha256": "cd7a16de08fc48a9189383ec0be106b64a81e754ff867fdd8cb96fe6280c927f",
  "v": "cd7a16de",
  "w": 512,
  "h": 384
 },
 "/examples/motion-object-pov/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 28204,
  "sha256": "646751ac767510f522bc0f4ea743654168af9f9e4e5c06b5ff8eb08e3cbe9838",
  "v": "646751ac",
  "w": 384,
  "h": 288
 },
 "/examples/motion-object-pov/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 188732,
  "sha256": "5823162199bd1d28c505e3b4714852edea85ae6349f9907968cf88d84adf5f65",
  "v": "58231621",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-object-pov/1/in-image.384.webp?v=646751ac"
 },
 "/examples/motion-object-pov/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 41844,
  "sha256": "2b892eeb266fc3c8b08b5a2113a9ff5f77a7c9c42b196cb1e2228534d233fb87",
  "v": "2b892eeb",
  "w": 512,
  "h": 384
 },
 "/examples/motion-one-take/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22016,
  "sha256": "fdd39a3820511055b250c21e1391fd475456cf3801016f1f42c17ffd3fe9cd58",
  "v": "fdd39a38",
  "w": 384,
  "h": 288
 },
 "/examples/motion-one-take/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 155302,
  "sha256": "551d005b4750548b0ece100f42b88001553a802927034743045e43dbc7879685",
  "v": "551d005b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-one-take/1/in-image.384.webp?v=fdd39a38"
 },
 "/examples/motion-one-take/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36663,
  "sha256": "44aabe214923f19265f90d9565589ef2d9d231ae810ec955805ea486dc8391c9",
  "v": "44aabe21",
  "w": 512,
  "h": 384
 },
 "/examples/motion-overhead/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 33280,
  "sha256": "cb6de685d2e98f324167b48e9b52d6110453bf0e798b52e9ae5993344f954f70",
  "v": "cb6de685",
  "w": 384,
  "h": 288
 },
 "/examples/motion-overhead/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 208891,
  "sha256": "b7da511d7aa6794c6bbcbdd8d2e06b506092d8354778dd8e61a600962033db3a",
  "v": "b7da511d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-overhead/1/in-image.384.webp?v=cb6de685"
 },
 "/examples/motion-overhead/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 48206,
  "sha256": "6723c0b53c643872b3bd1e0271289c6c6380ba63ee7bb0e9adf12d519a8cb453",
  "v": "6723c0b5",
  "w": 512,
  "h": 384
 },
 "/examples/motion-pan-left/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18866,
  "sha256": "b03f41fabf394996db0deb6f61de329281c9a0283d7663d525c07aaff828b7d6",
  "v": "b03f41fa",
  "w": 384,
  "h": 288
 },
 "/examples/motion-pan-left/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 150316,
  "sha256": "acca485e12cedce59b49ab15facabc3484db4297cd0508f7602c4f20df689aef",
  "v": "acca485e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-pan-left/1/in-image.384.webp?v=b03f41fa"
 },
 "/examples/motion-pan-left/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33059,
  "sha256": "91e8cea4c784d2aafb080a18450a3aeefaa7718e20435f92adf3b01aba932dfe",
  "v": "91e8cea4",
  "w": 512,
  "h": 384
 },
 "/examples/motion-pan-right/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15468,
  "sha256": "b8c133e05501053f40407976d3e76c30bf64e2ea6707734083017d927f62e655",
  "v": "b8c133e0",
  "w": 384,
  "h": 288
 },
 "/examples/motion-pan-right/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 115553,
  "sha256": "dfd09469100f88cd4e1344efb0808f2ad30e548461f6df93b865f299da664bc0",
  "v": "dfd09469",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-pan-right/1/in-image.384.webp?v=b8c133e0"
 },
 "/examples/motion-pan-right/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 23224,
  "sha256": "7bb66804faa49707eb982a87dad8ee648f38db855788ac52194701cbe0dc7624",
  "v": "7bb66804",
  "w": 512,
  "h": 384
 },
 "/examples/motion-pan/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20904,
  "sha256": "dffa459b7ae5e3e6844b47c0c11f2088b87fdcaea9ad997a95d0ee20edde82c4",
  "v": "dffa459b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-pan/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 144039,
  "sha256": "82c0f19b5b535f35bfd6b9879c572a1de9b89fabc0b776dcd60addf4853569dc",
  "v": "82c0f19b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-pan/1/in-image.384.webp?v=dffa459b"
 },
 "/examples/motion-pan/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36091,
  "sha256": "7ce7082a3ec1dc32e92ae32abc91d87d70a6974458d8e4275a7a2ea812c593ad",
  "v": "7ce7082a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-pedestal-down/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 13202,
  "sha256": "a01e1b2c9bd4e55aa98c90a12e75d80778846e202343495d0c02c08d80fea337",
  "v": "a01e1b2c",
  "w": 384,
  "h": 288
 },
 "/examples/motion-pedestal-down/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111388,
  "sha256": "149800f38fc373d7d9cb5979c78a714ec04f6fdc2cf77305ea9421d848156fa5",
  "v": "149800f3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-pedestal-down/1/in-image.384.webp?v=a01e1b2c"
 },
 "/examples/motion-pedestal-down/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26836,
  "sha256": "dc1b681c19786f470b08fcbd74e813a93615231eb949b8a0b9eac1ffa2a27fb4",
  "v": "dc1b681c",
  "w": 512,
  "h": 384
 },
 "/examples/motion-pov/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 28138,
  "sha256": "3b5a50ae733a79094fa10b3b66046f6799bba5962046d65f708dd24a92e47d67",
  "v": "3b5a50ae",
  "w": 384,
  "h": 288
 },
 "/examples/motion-pov/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 171946,
  "sha256": "5f2a6f01c73b902da62bf73906dd1379eed3ac3feaf18d06ce74649149458583",
  "v": "5f2a6f01",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-pov/1/in-image.384.webp?v=3b5a50ae"
 },
 "/examples/motion-pov/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31371,
  "sha256": "dedb099eb0f57294d89f2d4542a41c9703d94f8ec4de594f3c47eff671d2da58",
  "v": "dedb099e",
  "w": 512,
  "h": 384
 },
 "/examples/motion-rap-flex/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16458,
  "sha256": "6c95a1c73e4e43a7a6ad39a582ae2b45cf9d41829982bada71f6231f637b4d25",
  "v": "6c95a1c7",
  "w": 384,
  "h": 288
 },
 "/examples/motion-rap-flex/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114644,
  "sha256": "1f8391136d49d589b6ab95a137520e91ff714e51a45339db3d8739ca4474f003",
  "v": "1f839113",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-rap-flex/1/in-image.384.webp?v=6c95a1c7"
 },
 "/examples/motion-rap-flex/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24151,
  "sha256": "76643add24cabc6ffb00318384fd844b24f53df4871925f82169af95851d24c7",
  "v": "76643add",
  "w": 512,
  "h": 384
 },
 "/examples/motion-rapid-zoom-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18878,
  "sha256": "03bf7f8de16689bb15034fca0ce45003a02b72e6a698a8300b910f00297b341a",
  "v": "03bf7f8d",
  "w": 384,
  "h": 288
 },
 "/examples/motion-rapid-zoom-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 132737,
  "sha256": "91f4e3bb86b2d58298c2a5bbea5b0e978448adafff4cb22dbf8fc87551bca614",
  "v": "91f4e3bb",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-rapid-zoom-in/1/in-image.384.webp?v=03bf7f8d"
 },
 "/examples/motion-rapid-zoom-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24041,
  "sha256": "30e42f8793857b76f37abaf88449650418f179e7af58b2f4fa8a66906991fd7a",
  "v": "30e42f87",
  "w": 512,
  "h": 384
 },
 "/examples/motion-rapid-zoom-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9372,
  "sha256": "4ea70267d9296c97fbc1b8037e24ea0e9b7a2311313a6ba4725c45c904486aec",
  "v": "4ea70267",
  "w": 384,
  "h": 288
 },
 "/examples/motion-rapid-zoom-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 75468,
  "sha256": "e7d08a64d848da8a620e7e6776a16e92e2453a3d2bbdfb078ec71cb11f53e4fa",
  "v": "e7d08a64",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-rapid-zoom-out/1/in-image.384.webp?v=4ea70267"
 },
 "/examples/motion-rapid-zoom-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27230,
  "sha256": "d69f650c9480c6e7e962c7e9f8861946d712ef07879d1308094a043c2aa3c87a",
  "v": "d69f650c",
  "w": 512,
  "h": 384
 },
 "/examples/motion-robo-arm/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10612,
  "sha256": "1c51b446e0150ff38eec53966e5b2d39eca46f0b8ce8875bda051b15892f5509",
  "v": "1c51b446",
  "w": 384,
  "h": 288
 },
 "/examples/motion-robo-arm/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 80550,
  "sha256": "ef039d2ed271d3c91bc7344abbd1562df2eb62331d95c78380dd8c9edd6bfec9",
  "v": "ef039d2e",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-robo-arm/1/in-image.384.webp?v=1c51b446"
 },
 "/examples/motion-robo-arm/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 20516,
  "sha256": "ce5f6b118c5bcfd4534773b10f13e85a413b140f377a6057afe7e9f3d5ee964b",
  "v": "ce5f6b11",
  "w": 512,
  "h": 384
 },
 "/examples/motion-roll-transition/1/in-end-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8448,
  "sha256": "d6fd891779783d28090465c42228a42ffefe40db2522516846445429208e5880",
  "v": "d6fd8917",
  "w": 384,
  "h": 288
 },
 "/examples/motion-roll-transition/1/in-end-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 71150,
  "sha256": "9f3d1facd810d7799db9cd67638a3f05865a1190fbfb69a7d58809b19b416551",
  "v": "9f3d1fac",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-roll-transition/1/in-end-image.384.webp?v=d6fd8917"
 },
 "/examples/motion-roll-transition/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 8990,
  "sha256": "8b91b8ae3bc596496565e1dd0cfcfbd2cf92d97a993d2a03b357e84fd8317ee4",
  "v": "8b91b8ae",
  "w": 384,
  "h": 288
 },
 "/examples/motion-roll-transition/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 65975,
  "sha256": "d08e166305cf092e84c3d28fccec0bca4a1d037a4fbd382effe72e682463954c",
  "v": "d08e1663",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-roll-transition/1/in-image.384.webp?v=8b91b8ae"
 },
 "/examples/motion-roll-transition/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 18209,
  "sha256": "0836353aaac6a2d86cb66937422400ba3a03887f373420f6db4ef89171c1369a",
  "v": "0836353a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-silent-machine/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10902,
  "sha256": "2566cfb9299e5436ae9a73629e7ccc2fddb3d691190a8ef6a44225f6a7d3d997",
  "v": "2566cfb9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-silent-machine/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 100606,
  "sha256": "a5473dff9517f99349a85e875ccff51f310281bc1ed2d7b2e1fefef28f47fcf4",
  "v": "a5473dff",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-silent-machine/1/in-image.384.webp?v=2566cfb9"
 },
 "/examples/motion-silent-machine/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 25170,
  "sha256": "e5fd192ab60e6a8c27bd291c5486a343c511026cf06262981fc9bad1e9a139b2",
  "v": "e5fd192a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-skate-cruise/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21788,
  "sha256": "1391d3f796570ddd33f326ba358106e636a0da91cb376acff46136f222e87fc9",
  "v": "1391d3f7",
  "w": 384,
  "h": 288
 },
 "/examples/motion-skate-cruise/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 158453,
  "sha256": "5525ec30fbb2fa0f02d84542f143ad39afc2e2a24088981cea2f8c0b3216f29e",
  "v": "5525ec30",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-skate-cruise/1/in-image.384.webp?v=1391d3f7"
 },
 "/examples/motion-skate-cruise/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 31282,
  "sha256": "1b89cb2511b38ccfbd910129896841d19e11b5276a2c6ba25d48141173bfc95f",
  "v": "1b89cb25",
  "w": 512,
  "h": 384
 },
 "/examples/motion-skateboard-glide/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10828,
  "sha256": "aaf0590a5c8da2a64bf3dbb85984214956a1533e4216d19d7715b32a70067b85",
  "v": "aaf0590a",
  "w": 384,
  "h": 288
 },
 "/examples/motion-skateboard-glide/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 90422,
  "sha256": "4ec29e1c93b788713822c83032589fe689970b71c87e21b0a6753135a72abea8",
  "v": "4ec29e1c",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-skateboard-glide/1/in-image.384.webp?v=aaf0590a"
 },
 "/examples/motion-skateboard-glide/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 17218,
  "sha256": "6ba53a057e62085574479c6c74c10b07356ff3985cf011632133455a82e000f6",
  "v": "6ba53a05",
  "w": 512,
  "h": 384
 },
 "/examples/motion-skateboard-ollie/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10944,
  "sha256": "efcde37a02d6edbcaf4844074d670a35746affb1ad73bac52147c5874d84b91f",
  "v": "efcde37a",
  "w": 384,
  "h": 288
 },
 "/examples/motion-skateboard-ollie/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 89357,
  "sha256": "2482aa22e837aee03f1bc1882634566fc891acaaf0803a37e3c6c7409e5770aa",
  "v": "2482aa22",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-skateboard-ollie/1/in-image.384.webp?v=efcde37a"
 },
 "/examples/motion-skateboard-ollie/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24678,
  "sha256": "b00f12397b0badb14b41f1710c7ad5d6c02ea22e0cd4c9bfba67a23fbd0e589c",
  "v": "b00f1239",
  "w": 512,
  "h": 384
 },
 "/examples/motion-ski-carving/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16492,
  "sha256": "aa87243dacbb076b93f6e14d0cfd83da49f8ff2171f1e4e4f6e3b5461fda12fa",
  "v": "aa87243d",
  "w": 384,
  "h": 288
 },
 "/examples/motion-ski-carving/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 123556,
  "sha256": "6470d5bd81f16113d4c8ba8a322278a9059f8d264a2b8a974a8012cd4781e14f",
  "v": "6470d5bd",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-ski-carving/1/in-image.384.webp?v=aa87243d"
 },
 "/examples/motion-ski-carving/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21779,
  "sha256": "cfa42e3db2064ceb0256ab958aafc944fc68a6e26913b9a9e07c13feb1563191",
  "v": "cfa42e3d",
  "w": 512,
  "h": 384
 },
 "/examples/motion-ski-powder/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 17794,
  "sha256": "6efd57703caaa609fb6b483ab7fec82e1501adb1d9effd4ab6353a622814144e",
  "v": "6efd5770",
  "w": 384,
  "h": 288
 },
 "/examples/motion-ski-powder/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 111300,
  "sha256": "80efd63d22c7488cf36d0018e69989d531e8049091e35694085455bd198e5676",
  "v": "80efd63d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-ski-powder/1/in-image.384.webp?v=6efd5770"
 },
 "/examples/motion-ski-powder/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 27229,
  "sha256": "fb2bc146b0de04af5220429615bd99796a74302f77cd0ca92451d38c71851e39",
  "v": "fb2bc146",
  "w": 512,
  "h": 384
 },
 "/examples/motion-slow-motion/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 10010,
  "sha256": "433419b40f545b2293a3f1bf0ea3d5b84acb8fb0de4712c1cc6f3a760e4ae6f8",
  "v": "433419b4",
  "w": 384,
  "h": 288
 },
 "/examples/motion-slow-motion/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 83448,
  "sha256": "6ed560e18b392f5efaab5876c24ba3c2181556ae23d3f8fed44023adecdc3725",
  "v": "6ed560e1",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-slow-motion/1/in-image.384.webp?v=433419b4"
 },
 "/examples/motion-slow-motion/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 18081,
  "sha256": "af3c9bc31583f92c8741fa4645cd356df5aecbf9c2d4b71350df7bed8db4278c",
  "v": "af3c9bc3",
  "w": 512,
  "h": 384
 },
 "/examples/motion-snorricam/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22252,
  "sha256": "37dd4061187695c76441eeb41821161d0bdc1d8fa40d6e7e07b68688f32349b4",
  "v": "37dd4061",
  "w": 384,
  "h": 288
 },
 "/examples/motion-snorricam/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 142487,
  "sha256": "573ba9fab13922483150c9d94d6e74befa12c38337af50981306688c92debede",
  "v": "573ba9fa",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-snorricam/1/in-image.384.webp?v=37dd4061"
 },
 "/examples/motion-snorricam/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 21135,
  "sha256": "99edd42a92fa015e29f8c1bb8c826dcdc29a2dbae75a570c878588d9f15b8872",
  "v": "99edd42a",
  "w": 512,
  "h": 384
 },
 "/examples/motion-snowboard-carving/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15892,
  "sha256": "10296ec0631e59d15a11b598fbbe652112a9deaa6c4cd6d59dc5dd379e5b3214",
  "v": "10296ec0",
  "w": 384,
  "h": 288
 },
 "/examples/motion-snowboard-carving/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 126802,
  "sha256": "b4d67e9d3541da9753bee6712431a6b9ff90dc004288018d4575cd5b6035d5ca",
  "v": "b4d67e9d",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-snowboard-carving/1/in-image.384.webp?v=10296ec0"
 },
 "/examples/motion-snowboard-carving/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24255,
  "sha256": "111079bbb4fe1bc3c0ed3479e95e89744edc2844e17f9caab5b5273d4d84dfd9",
  "v": "111079bb",
  "w": 512,
  "h": 384
 },
 "/examples/motion-static/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27374,
  "sha256": "73f226f97ea0854e7ca1cbc74526b6c9416bedff4c6834bcf7bce8749ae29d23",
  "v": "73f226f9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-static/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 188023,
  "sha256": "49983e7b6cfe910f3dba6c0c095991590e8d02492a59ad7b63f3609d79178f5d",
  "v": "49983e7b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-static/1/in-image.384.webp?v=73f226f9"
 },
 "/examples/motion-static/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 43382,
  "sha256": "bedf7e56791775a5e5e28b05df2061b771c1fe4c833d2e607c372317da8489ba",
  "v": "bedf7e56",
  "w": 512,
  "h": 384
 },
 "/examples/motion-super-dolly-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 18222,
  "sha256": "f5bdc1ccc8f32316ba02e3ad03145222d7da2c5f2f9402b5d9a919866310ff9f",
  "v": "f5bdc1cc",
  "w": 384,
  "h": 288
 },
 "/examples/motion-super-dolly-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 133435,
  "sha256": "3362b3286fd5a97b79326d29a96163742216e026dbf37853b52cc1b89a3366d1",
  "v": "3362b328",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-super-dolly-in/1/in-image.384.webp?v=f5bdc1cc"
 },
 "/examples/motion-super-dolly-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 17171,
  "sha256": "def09862191587edf487b1018ec66f2ce32258becd0135d03256ad6bd02340a3",
  "v": "def09862",
  "w": 512,
  "h": 384
 },
 "/examples/motion-super-dolly-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7984,
  "sha256": "3ff154ada86afa76f1b3379d1a100168ef6d54463956614c4d65632eb2fd4852",
  "v": "3ff154ad",
  "w": 384,
  "h": 288
 },
 "/examples/motion-super-dolly-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 66507,
  "sha256": "e906492a2f69aa61579a284ab1d16ecaa5ef492b494c68935ced97606e46a0cf",
  "v": "e906492a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-super-dolly-out/1/in-image.384.webp?v=3ff154ad"
 },
 "/examples/motion-super-dolly-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 23222,
  "sha256": "16deec690ad20b068237e53138d92da5707daa6350974990ae3732aa8c51010d",
  "v": "16deec69",
  "w": 512,
  "h": 384
 },
 "/examples/motion-through-object-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16918,
  "sha256": "8a399cd877c306b064a834bd7466629acf4788b7ea6b48316ff8ed90e412dce8",
  "v": "8a399cd8",
  "w": 384,
  "h": 288
 },
 "/examples/motion-through-object-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 128779,
  "sha256": "51080a59dcbd721a3f33292d9111fd9b2c6ee95db71798ba9d536a5b06e5da3e",
  "v": "51080a59",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-through-object-in/1/in-image.384.webp?v=8a399cd8"
 },
 "/examples/motion-through-object-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 32101,
  "sha256": "3f43d70f5ff5a2ef0be40d0ce268f8f2b2ddc5b7119284a2bf4fd8fa660c667f",
  "v": "3f43d70f",
  "w": 512,
  "h": 384
 },
 "/examples/motion-through-object-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16662,
  "sha256": "dd7ac5078528f0a58a39758df14507b68db40093156a6255a88cf780fed40df6",
  "v": "dd7ac507",
  "w": 384,
  "h": 288
 },
 "/examples/motion-through-object-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 117248,
  "sha256": "de956379cc98e29b1d7f1b9c3e9cd27fde597eea5788b172ef42d43246b8a5e5",
  "v": "de956379",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-through-object-out/1/in-image.384.webp?v=dd7ac507"
 },
 "/examples/motion-through-object-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36023,
  "sha256": "2bc28b2f7fce1959a50facdcfb2140027e4f1804059463d0906151a6d70ee956",
  "v": "2bc28b2f",
  "w": 512,
  "h": 384
 },
 "/examples/motion-tilt-down/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 7590,
  "sha256": "8f84de0b31f72958f19407300c09baf60893dcdadc2afb4f6a8c5185777467a5",
  "v": "8f84de0b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-tilt-down/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 60682,
  "sha256": "bb6e0ffe3e52234d9b72caebe73d3e0f5b5e2c2f6ee421966429f0476333451e",
  "v": "bb6e0ffe",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-tilt-down/1/in-image.384.webp?v=8f84de0b"
 },
 "/examples/motion-tilt-down/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 18558,
  "sha256": "f21ecf3bac92fc8ed86d9f282e089ed84a8b141a1ba153ce87af69344d8fb143",
  "v": "f21ecf3b",
  "w": 512,
  "h": 384
 },
 "/examples/motion-tilt-up/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 27880,
  "sha256": "f005a23a3bd90a8b39605a930075207ab94286f5b4f38e76780961c7f1dfe358",
  "v": "f005a23a",
  "w": 384,
  "h": 288
 },
 "/examples/motion-tilt-up/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 171858,
  "sha256": "d1aa18beabc37c68325345c10c6513cc9cb4cfff2668e6fb12132317d9db0b9b",
  "v": "d1aa18be",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-tilt-up/1/in-image.384.webp?v=f005a23a"
 },
 "/examples/motion-timelapse-glam/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 14190,
  "sha256": "c5a4814d1f34bea2b71e9d29cf4cb06e5527418977476712715fa632fa5bc802",
  "v": "c5a4814d",
  "w": 384,
  "h": 288
 },
 "/examples/motion-timelapse-glam/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 102277,
  "sha256": "7218770426d8ba989141e2794ac24841dfba40c43e24461e1fbbb313612a1e41",
  "v": "72187704",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-timelapse-glam/1/in-image.384.webp?v=c5a4814d"
 },
 "/examples/motion-timelapse-human/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 19352,
  "sha256": "cc19180b33514c3d40595de8092b7ca49ca92374365a1c99268bc4bea98b7948",
  "v": "cc19180b",
  "w": 384,
  "h": 288
 },
 "/examples/motion-timelapse-human/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 134267,
  "sha256": "10384b2a64d94c97a5e4af5353c82173845f1e279b4cbb5f4449c76a8fb9632c",
  "v": "10384b2a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-timelapse-human/1/in-image.384.webp?v=cc19180b"
 },
 "/examples/motion-timelapse-human/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 37370,
  "sha256": "98f49e458c497aea11130e9a6109c0c90d575cd892d2aad9a2c19ccaac464449",
  "v": "98f49e45",
  "w": 512,
  "h": 384
 },
 "/examples/motion-timelapse-landscape/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 21830,
  "sha256": "be12b6c7073c87ec2fadba34638b7ec000712fc5c5b12a7bf2f15af1156e22bc",
  "v": "be12b6c7",
  "w": 384,
  "h": 288
 },
 "/examples/motion-timelapse-landscape/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 159265,
  "sha256": "fcf4a54fe4933355eb17b78df015894b6321823950acef3880d9c9682ac6a4c1",
  "v": "fcf4a54f",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-timelapse-landscape/1/in-image.384.webp?v=be12b6c7"
 },
 "/examples/motion-timelapse-landscape/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36991,
  "sha256": "637e7517d2ca6a5a137a68622325a801aa77c87bdf82d0106393efc75ec6f6cf",
  "v": "637e7517",
  "w": 512,
  "h": 384
 },
 "/examples/motion-timelapse/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 22996,
  "sha256": "142c309a142046023e450706658ab25d6fcc793a5b938a007659286d2489abf9",
  "v": "142c309a",
  "w": 384,
  "h": 288
 },
 "/examples/motion-timelapse/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 171207,
  "sha256": "8d4bc8f85db3eef46011a389dccf43980fb24f26c1f90089d29d0890cae00bcf",
  "v": "8d4bc8f8",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-timelapse/1/in-image.384.webp?v=142c309a"
 },
 "/examples/motion-timelapse/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 36920,
  "sha256": "faad1cb53eadcd49072403260d61c7fa5af95174b797a1f30890caf81404ac69",
  "v": "faad1cb5",
  "w": 512,
  "h": 384
 },
 "/examples/motion-truck-left/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 20818,
  "sha256": "cdc9249d6145a65e81e032154f0ed245da2f505d5d3b21a59afdf829a38420a2",
  "v": "cdc9249d",
  "w": 384,
  "h": 288
 },
 "/examples/motion-truck-left/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 155075,
  "sha256": "b643bc9bf37e117f3f97e2b6ac5683a9b2640e6515b8636f3124c126c379e213",
  "v": "b643bc9b",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-truck-left/1/in-image.384.webp?v=cdc9249d"
 },
 "/examples/motion-truck-left/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 33330,
  "sha256": "85251cf491f6b6f22cbbab49c8944f14041fd383f58a9e1632bf9be7e96283f2",
  "v": "85251cf4",
  "w": 512,
  "h": 384
 },
 "/examples/motion-whip-pan/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16856,
  "sha256": "3f9314e96d39d3d1521d8a35d97b0f8214bf42b9343bd9d54afd5118768ecc88",
  "v": "3f9314e9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-whip-pan/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 137017,
  "sha256": "963436a3a29fba70f45ae4692bdefbf9936e3a0529739db164e07c921ed1c45f",
  "v": "963436a3",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-whip-pan/1/in-image.384.webp?v=3f9314e9"
 },
 "/examples/motion-whip-pan/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24591,
  "sha256": "d12ab7e6413601b9f93882d821a80be1eea8502b71cc65e53470a11c0bb099a8",
  "v": "d12ab7e6",
  "w": 512,
  "h": 384
 },
 "/examples/motion-wiggle/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 24604,
  "sha256": "a49021e9c2eb5050116c53440946035df02c231722351a360f38acf34c9c7735",
  "v": "a49021e9",
  "w": 384,
  "h": 288
 },
 "/examples/motion-wiggle/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165693,
  "sha256": "9ba8c964f5fa70a24df1be0022174c6df3a9b17563abca3229574b34995643a0",
  "v": "9ba8c964",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-wiggle/1/in-image.384.webp?v=a49021e9"
 },
 "/examples/motion-wiggle/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 39517,
  "sha256": "e6c43570ef2f2e688126a4b07ba89966b3099891c0a7bfedd16d8e4dfc969173",
  "v": "e6c43570",
  "w": 512,
  "h": 384
 },
 "/examples/motion-yoyo-zoom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 23864,
  "sha256": "ebda53bd01e24d3c658247ef8400dc2fd25d2ff7c4a29292b355631c1575dd10",
  "v": "ebda53bd",
  "w": 384,
  "h": 288
 },
 "/examples/motion-yoyo-zoom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 165757,
  "sha256": "8cebc35a25b2fe4492e3d8c939430d7f11ca9c095e2bb5ee4ba14ac71c0e58fe",
  "v": "8cebc35a",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-yoyo-zoom/1/in-image.384.webp?v=ebda53bd"
 },
 "/examples/motion-yoyo-zoom/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 16072,
  "sha256": "5eafd6cac9783eae2c58eaa38e196bd7af3fa073d1f3edc39e4e54f06d9dbd8f",
  "v": "5eafd6ca",
  "w": 512,
  "h": 384
 },
 "/examples/motion-zoom-in/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 9574,
  "sha256": "ae686c1179c23b20729fbd0142ab70291c97e1bc2d1a0771bde65951bd5314de",
  "v": "ae686c11",
  "w": 384,
  "h": 288
 },
 "/examples/motion-zoom-in/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 90873,
  "sha256": "90b1ef67de1c551ef5bb2327bbad56c2e2cde28870f7fbc08bdf6b0db06a9e52",
  "v": "90b1ef67",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-zoom-in/1/in-image.384.webp?v=ae686c11"
 },
 "/examples/motion-zoom-in/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 26252,
  "sha256": "59fb23d4575588de049c842b7893e18abd3abe53b3b880857868f47a72c2d7d4",
  "v": "59fb23d4",
  "w": 512,
  "h": 384
 },
 "/examples/motion-zoom-out/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 15786,
  "sha256": "61d494f582d7024cff4195566597b9557a4760836075cf1868efa6c1beedd5be",
  "v": "61d494f5",
  "w": 384,
  "h": 288
 },
 "/examples/motion-zoom-out/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 114405,
  "sha256": "46191848fcbeb5b17b1b9b9a81aa442146aaeebcf20ba0b1fee7e39494391780",
  "v": "46191848",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-zoom-out/1/in-image.384.webp?v=61d494f5"
 },
 "/examples/motion-zoom-out/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 24318,
  "sha256": "6bf5fbd759f2ec6c5536e7c403d245e97123b5c2c276ce49ff2b9acfa54ca2e1",
  "v": "6bf5fbd7",
  "w": 512,
  "h": 384
 },
 "/examples/motion-zoom/1/in-image.384.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 16694,
  "sha256": "80f9d47750b3b79366373734514e4a8e80820ac68755da61eea47e5319bad5d8",
  "v": "80f9d477",
  "w": 384,
  "h": 288
 },
 "/examples/motion-zoom/1/in-image.jpg": {
  "role": "in",
  "type": "image/jpeg",
  "bytes": 141407,
  "sha256": "dfedb461bb9f7939e8ece795700d6078bb6c0105ae8ae06dce63ef756c05aaf5",
  "v": "dfedb461",
  "w": 1024,
  "h": 768,
  "thumb": "/examples/motion-zoom/1/in-image.384.webp?v=80f9d477"
 },
 "/examples/motion-zoom/1/out-peak.jpg": {
  "role": "show",
  "type": "image/jpeg",
  "bytes": 46993,
  "sha256": "2276539245774962ff3f8c239c736b79867e2188f31cc6050ceeeea2431f7ff0",
  "v": "22765392",
  "w": 512,
  "h": 384
 },
 "/samples/clean-voice/noisy.m4a": {
  "role": "in",
  "type": "audio/mp4",
  "bytes": 130181,
  "sha256": "22ee527ba4f1418e42e7d7a8dce4d9b2e2231a6932186c7b9e3f91d24c1d442d",
  "v": "22ee527b"
 },
 "/samples/clean-voice/quiet.webp": {
  "role": "show",
  "type": "image/webp",
  "bytes": 71538,
  "sha256": "bbb1d462229eb5aa6e7fea10b1b7a5e1f784b2d2b4cdd0346dedba3e9f66c430",
  "v": "bbb1d462",
  "w": 1280,
  "h": 960
 }
};
