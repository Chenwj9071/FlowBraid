# Native Split 楠岃瘉鎶ュ憡

## 澶勭悊鐨勯棶棰?- 淇 `src/engine.ts` 涓爣鍑?`codex` review 鍏煎鍒嗘敮寮曠敤鏈畾涔?`outputFile` 鐨勯棶棰樸€?- 淇 `test/split-prompt-paths.test.ts` 鐨?fake Codex 瑙ｆ瀽瑙勫垯锛屼娇鍏跺尮閰嶅綋鍓?prompt 缁撴瀯銆?- 鏈湴瀹夎骞堕獙璇?`flowbraid` CLI 鍛戒护鍙敤銆?- 浣跨敤宸茬紪璇戜骇鐗╁拰宸插畨瑁呭懡浠わ紝閲嶆柊璺戦€?native split 绀轰緥銆?
## 鏍瑰洜
- 鏍囧噯 `codex` 鍒嗘敮鍦?`review` 鏃у吋瀹归€昏緫閲岃鐢ㄤ簡浣滅敤鍩熷鐨?`outputFile`锛屽鑷?verify 鑺傜偣鐩存帴寮傚父锛屾祦绋嬩笉鏂洖娴佸埌 `develop`锛屾渶鍚庢挒涓?`maxSteps`銆?- 娴嬭瘯 helper 閲屽 `latest.human.feedback` 鐨勬鍒欎粛鎸夋棫 prompt 缁撴瀯瑙ｆ瀽锛屽鑷?`latestHuman` 璇绘垚绌哄瓧绗︿覆鑰屼笉鏄?`NONE`銆?
## 缁撴灉
- `npm run check` 閫氳繃銆?- `npm test -- test/split-prompt-paths.test.ts` 閫氳繃銆?- `npm test -- test/codex-native-split-demo.test.ts test/native-node-cli.test.ts` 閫氳繃銆?- `flowbraid --help` 鍙敤锛岃鏄庢湰鍦?link 瀹夎鎴愬姛銆?- `flowbraid resume` 缁х画鎵ц鐨?native split 绀轰緥鏈€缁堝埌杈?`completed`銆?
## 鍚庣画寤鸿
- 缁х画鏀剁揣 `mode: exec|review` 鐨勫吋瀹硅矾寰勶紝鎶婁富璺緞瀹屽叏缁熶竴鍒?`runtime-state + outcome`銆?- 缁欑ず渚嬪鍔犳洿鏄庣‘鐨勨€滃畨瑁呭悗杩愯鈥濊鏄庯紝鍑忓皯鍚庣画瀵?`tsx src/cli.ts` 鐨勪緷璧栥€?- 濡傛灉鍚庣画鍐嶆敼 prompt 缁撴瀯锛屼紭鍏堝悓姝ユ祴璇?helper 鐨勮В鏋愯鍒欙紝閬垮厤鍋囧け璐ャ€?
