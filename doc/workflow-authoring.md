# FlowBraid Workflow 缂栧啓鎸囧崡

鏈枃璇存槑 `workflow.yaml` / `workflow.yml` / `workflow.json` 鐨勫啓娉曘€佸瓧娈靛惈涔夈€佽繍琛岃涔夊拰鎺ㄨ崘鐢ㄦ硶銆?

鐩爣璇昏€咃細
- 闇€瑕佽嚜宸辩紪鎺?FlowBraid 宸ヤ綔娴佺殑浜?
- 鎯崇悊瑙?`workdir` / `contextDir` / `approval` / `agent_session` 璇箟鐨勪汉
- 鎯冲弬鑰冩帹鑽愭ā寮忓拰閬垮厤甯歌鍧戠殑浜?

鏈枃鎻忚堪鐨勬槸褰撳墠浠撳簱宸茬粡瀹炵幇骞舵牎楠屾敮鎸佺殑鑳藉姏锛屼笉鍖呭惈鏈潵璁捐鑽夋銆?

## 1. 鏂囦欢鏍煎紡

FlowBraid 鏀寔锛?
- YAML锛歚.yaml` / `.yml`
- JSON锛歚.json`

寤鸿浼樺厛浣跨敤 YAML锛屽洜涓猴細
- 鍙鎬ф洿楂?
- 澶氳 `prompt` / `command` 鏇村鏄撳啓
- 鏇撮€傚悎浜哄伐缁存姢

## 2. 鏈€灏忓伐浣滄祦

鏈€灏忓彲杩愯绀轰緥锛?

```yaml
id: hello-demo
start: hello
nodes:
  hello:
    type: shell
    command: echo hello
    next: done

  done:
    type: end
    message: finished
```

杩愯锛?

```bash
flowbraid run path/to/workflow.yaml
```

## 3. 椤跺眰瀛楁

```yaml
id: your-workflow-id
start: first-node-id
workdir: ./shared-workdir
contextDir: ./default-context
nodes:
  ...
```

瀛楁璇存槑锛?
- `id`锛氬繀濉紝宸ヤ綔娴佸敮涓€鏍囪瘑銆?
- `start`锛氬繀濉紝璧峰鑺傜偣 id銆?
- `workdir`锛氬彲閫夛紝workflow 绾ч粯璁や笟鍔＄洰褰曘€?
- `contextDir`锛氬彲閫夛紝workflow 绾ч粯璁や笂涓嬫枃鐩綍銆?
- `nodes`锛氬繀濉紝鑺傜偣瀛楀吀锛宬ey 灏辨槸鑺傜偣 id銆?

## 4. 鑺傜偣閫氱敤瀛楁

鎵€鏈夎妭鐐归兘鏀寔浠ヤ笅閫氱敤瀛楁锛?
- `id`锛氬彲閫夛紝蹇呴』鍜岃妭鐐?key 涓€鑷淬€?
- `type`锛氬繀濉紝褰撳墠鏀寔 `shell`銆乣codex`銆乣agent_session`銆乣gate`銆乣approval`銆乣end`銆?
- `title`锛氬彲閫夛紝鎻忚堪瀛楁锛屼笉鍙備笌璋冨害銆?
- `next`锛氬彲閫夛紝榛樿涓嬩竴璺炽€?
- `transitions`锛氬彲閫夛紝鏀寔 `success`銆乣failure`銆乣default`銆乣approve`銆乣reject`銆?

鎺ㄨ崘瑙勫垯锛?
- 鍙湁涓€涓甯稿悗缁ф椂锛岀敤 `next`
- 鏈夋垚鍔?澶辫触鍒嗘敮鏃讹紝鐢?`transitions.success` / `transitions.failure`
- `approval` 蹇呴』鍐?`transitions.approve` / `transitions.reject`

## 5. 鐩綍妯″瀷

FlowBraid 閲屾湁涓変釜瀹规槗娣锋穯鐨勭洰褰曟蹇碉細
- `run workspace`锛氫繚瀛樼姸鎬併€佹秷鎭€佹棩蹇楀拰鑺傜偣浜х墿銆?
- `contextDir`锛氳妭鐐圭粓绔粯璁ゆ墦寮€鐨勭洰褰曪紝鏀捐鑹茶鏄庡拰灞€閮ㄧ害鏉熴€?
- `workdir`锛氳妭鐐圭湡姝ｄ慨鏀瑰拰楠岃瘉涓氬姟鏂囦欢鐨勭洰褰曘€?

榛樿瑙勫垯锛?
- 鑺傜偣 `workdir` 浼樺厛绾ф渶楂橈細鑺傜偣绾?`workdir` > workflow 绾?`workdir` > CLI `--workdir` > workflow 鏂囦欢鎵€鍦ㄧ洰褰曘€?
- 鑺傜偣 `contextDir` 浼樺厛绾ф渶楂橈細鑺傜偣绾?`contextDir` > workflow 绾?`contextDir` > 褰撳墠鑺傜偣鏈€缁堣В鏋愬嚭鏉ョ殑 `workdir`銆?

## 6. `shell` 鑺傜偣

```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

- `command` 蹇呭～锛岄潪绌哄瓧绗︿覆銆?
- `cwd` 鍙€夛紝鏈啓鏃堕粯璁や娇鐢ㄨ鑺傜偣鐨?`contextDir`銆?
- 鍛戒护閫€鍑虹爜涓?`0` 瑙嗕负鎴愬姛锛岄潪 `0` 瑙嗕负澶辫触銆?
- 濡傛灉閰嶇疆浜?`transitions.failure`锛屼細杩涘叆澶辫触鍒嗘敮銆?

## 7. `codex` 鑺傜偣

```yaml
develop:
  type: codex
  contextDir: ./demo-dev
  workdir: ./demo-workdir
  prompt: |
    Read AGENTS.md first, then implement the task.
  outputFile: develop-last-message.md
  transitions:
    success: verify
    failure: verify
```

- `prompt` 蹇呭～銆?
- `outputFile` 榛樿鏄?`codex-last-message.md`銆?
- `model` 鍙€夛紝鐢ㄤ簬瑕嗙洊榛樿妯″瀷銆?
- `reentry.mode` 鍙€夛紝鐢ㄤ簬鎺у埗鍥炴祦鏃跺浣曟仮澶嶈鑺傜偣鍘嗗彶浼氳瘽銆?
- 褰撳墠鎺ㄨ崘鎶?`codex` 鑺傜偣鍐欐垚鈥滀换鍔?+ outcome 涓婃姤鈥濇ā鍨嬶紝鑰屼笉鏄緷璧栬嚜鐒惰瑷€ `verdict` 瑙ｆ瀽銆?

### 瀹屾垚鍗忚

褰撳墠鎺ㄨ崘鍐欐硶涓嬶紝`codex` 鑺傜偣搴旀妸浠ヤ笅鍐呭鍐欒繘 `prompt`锛?
- 鏄庣‘瑕佹眰鍦ㄤ换鍔″畬鎴愬悗璋冪敤 `flowbraid node complete --outcome ...`
- 鏄庣‘瑕佹眰澶辫触鏃惰皟鐢?`flowbraid node fail`

鎺ㄨ崘 outcome锛?
- `success`锛氭櫘閫氫换鍔″畬鎴愶紝閫氬父娴佸悜 `transitions.success` 鎴?`next`
- `approve`锛氶獙鏀?瀹℃牳閫氳繃锛岄€氬父涔熻涓烘垚鍔熷垎鏀?
- `reject`锛氶獙鏀?瀹℃牳鎵撳洖锛岄€氬父鏄犲皠鍒板け璐ュ垎鏀垨鍥炴祦鍒嗘敮

璋冨害鍣ㄥ綋鍓嶄細浼樺厛璇诲彇锛?
- `nodes/<node-id>/state/runtime-state.json`
- 褰撳墠 attempt 鐨勬渶鏂?outcome 浜嬩欢

鍥犳鎺ㄨ崘鎶娾€滆妭鐐规槸鍚﹀畬鎴愩€佽蛋鍝潯鍒嗘敮鈥濈殑鐪熸簮寤虹珛鍦?runtime-state + outcome 涓婏紝鑰屼笉鏄彧闈犲瓙杩涚▼閫€鍑虹爜鎴栬嚜鐒惰瑷€缁撴灉銆?

### `mode` 鍏煎瀛楁

`mode` 鐩墠浠嶈瀹炵幇灞傛帴鍙楋紝浣嗗畠宸茬粡涓嶆槸鎺ㄨ崘涓昏矾寰勶細
- `mode: exec`锛氫负历史 workflow 保留的旧生成语义
- `mode: review`锛氫负历史 workflow 保留的 review/verdict 语义

鍏煎璇存槑锛?
- 鏃?workflow 浠嶅彲缁х画杩愯
- 新 workflow 不应围绕 `mode: review + verdict: approve|reject` 设计主流转
- 鏂扮ず渚嬪簲浼樺厛浣跨敤鏄惧紡 outcome 鍗忚

### `reentry`

`codex` 鑺傜偣鏀寔 `reentry` 閰嶇疆锛岀敤浜庢帶鍒跺悓涓€娆?run 鍐呭啀娆¤繘鍏ヨ鑺傜偣鏃跺浣曟墦寮€缁堢銆?

```yaml
develop:
  type: codex
  prompt: |
    Implement the task.
  reentry:
    mode: resume
```

鏀寔鍙栧€硷細
- `resume`锛氶粯璁ゅ€硷紝浼樺厛鎭㈠璇ヨ妭鐐逛笂涓€杞?`sessionId`銆?
- `new_with_history`锛氭柊寮€浼氳瘽锛屼絾甯︿笂鏈€鏂伴獙璇佸拰鍙嶉涓婁笅鏂囥€?
- `new`锛氭柊寮€浼氳瘽锛屽彧淇濈暀褰撳墠杞繀瑕佸紩瀵笺€?

琛ュ厖璇存槑锛?
- `reentry` 褰撳墠鍙 `codex` 鑺傜偣鐢熸晥銆?
- `agent_session` 鑺傜偣涓嶄娇鐢ㄨ繖涓瓧娈点€?
- native split 妯″紡涓嬶紝涓昏繘绋嬩細璁板綍璇ヨ妭鐐硅嚜宸辩殑 `sessionId`銆?

## 8. `agent_session` 鑺傜偣

```yaml
discuss:
  type: agent_session
  provider: codex
  prompt: |
    Ask the user what to build first.
    If information is still missing, return waiting_input.
    If the task boundary is clear, return completed.
  outputFile: turn-result.json
  next: done
```

- `provider` 褰撳墠鍙敮鎸?`codex`銆?
- 杩欐槸闀挎湡浜や簰鑺傜偣锛屾瘡娆″彧鍋氫竴杞?turn銆?
- `waiting_input` 鏃?run 杩涘叆 `paused`锛屽繀椤婚€氳繃 `flowbraid send <run-dir> <message>` 缁х画銆?
- `completed` 鏃剁户缁笅涓€璺炽€?
- `failed` 鏃舵寜 `transitions.failure` 澶勭悊銆?

## 9. `gate` 鑺傜偣

```yaml
checkpoint:
  type: gate
  prompt: |
    Check the generated files, then continue.
  next: next-step
```

- 杩涘叆鍚?run 浼氭殏鍋溿€?
- 閫氳繃 `flowbraid resume <run-dir>` 缁х画銆?
- 閫傚悎浜哄伐纭銆佹墜鍔ㄦ鏌ュ拰澶栭儴鏉′欢绛夊緟銆?

## 10. `approval` 鑺傜偣

```yaml
approve:
  type: approval
  prompt: |
    Human confirmation is required.
  transitions:
    approve: done
    reject: develop
```

- 蹇呴』閫氳繃 `flowbraid resume <run-dir> --decision approve|reject` 缁х画銆?
- `reject` 鏃跺綋鍓嶅疄鐜拌姹傚甫涓?`--message`銆?
- 浜哄伐鍙嶉浼氬啓鍏?`messages/human-feedback.jsonl`銆?

## 11. `end` 鑺傜偣

```yaml
done:
  type: end
  message: workflow completed
```

- 鍒拌揪鍚庡伐浣滄祦缁撴潫銆?

## 12. 鍒嗘敮瑙勫垯

鏅€氳妭鐐癸細
1. 鍛戒腑 `transitions.success` / `transitions.failure` 鏃朵紭鍏堣蛋瀵瑰簲鍒嗘敮銆?
2. 鍚﹀垯濡傛灉瀛樺湪 `transitions.default`锛岃蛋 `default`銆?
3. 鍚﹀垯濡傛灉瀛樺湪 `next`锛岃蛋 `next`銆?
4. 鍚﹀垯缁撴潫褰撳墠閾捐矾锛涜嫢鑺傜偣鏄け璐ユ€侊紝鍒欐暣涓?run 澶辫触銆?

`approval` 鑺傜偣锛?
1. `approve` 璧?`transitions.approve`
2. `reject` 璧?`transitions.reject`

瀵?`codex` 鑺傜偣锛屾帹鑽愭妸鍒嗘敮鐞嗚В涓衡€滄渶缁?outcome 鏄犲皠鈥濓細
- `success` / `approve` 閫氬父杩涘叆鎴愬姛鍒嗘敮
- `reject` / `failure` 閫氬父杩涘叆澶辫触鍒嗘敮
- 濡傛灉鑺傜偣鍙槸鏆傚仠鎴栫瓑寰呬汉宸ュ姩浣滐紝涓嶅簲鎻愬墠涓婃姤瀹屾垚 outcome

## 13. 鎺ㄨ崘缂栨帓妯″紡

```yaml
id: standard-loop
workdir: ./demo-workdir
contextDir: ./demo-dev
start: prepare
nodes:
  prepare:
    type: shell
    command: echo prepare
    next: develop

  develop:
    type: codex
    contextDir: ./demo-dev
    workdir: ./demo-workdir
    prompt: |
      Implement the task.
      When finished, report the final result with:
      `flowbraid node complete --outcome success`
    next: verify

  verify:
    type: codex
    contextDir: ./demo-verify
    workdir: ./demo-workdir
    prompt: |
      Verify the task.
      Write the verification report to the artifact path.
      If verification fails, report:
      `flowbraid node complete --outcome reject`
      If verification passes, report:
      `flowbraid node complete --outcome approve`
    transitions:
      success: approve
      failure: develop

  approve:
    type: approval
    transitions:
      approve: done
      reject: develop

  done:
    type: end
```

杩欎釜妯″紡浣撶幇鐨勬槸锛?
- `develop` 璐熻矗浜у嚭鍏变韩涓氬姟淇敼
- `verify` 璐熻矗鐪熸鎵ц楠岃瘉骞剁粰鍑烘樉寮?outcome
- `approval` 璐熻矗鏈€缁堜汉宸ョ‘璁?
- 鍥炴祦渚濊禆鏄惧紡鐘舵€佸拰缁撴瀯鍖栧弽棣堬紝鑰屼笉鏄殣寮忕害瀹?

## 14. 甯歌閿欒

- `start` 鎸囧悜涓嶅瓨鍦ㄨ妭鐐广€?
- `approval` 缂哄皯 `approve` 鎴?`reject`銆?
- `agent_session` 璇敤 `resume`銆?
- `codex` 鑺傜偣 prompt 娌℃湁鏄庣‘瑕佹眰涓婃姤 `flowbraid node complete --outcome ...`銆?
- 历史 workflow 仍可能使用 `mode: review` 和 `verdict:`；新 workflow 不应把它们当作节点身份或主流转协议。
- 鎶?`contextDir` 褰撲綔鐪熷疄涓氬姟鐩綍銆?
- 鍦ㄥ崟琛?YAML 閲岀‖濉炲鏉?shell 鍛戒护銆?
- 娌℃湁澶辫触鍒嗘敮鍗存湡寰呰嚜鍔ㄥ洖娴併€?

## 15. 鎺ㄨ崘瀹炶返

- 姣忎釜鑺傜偣鍙仛涓€绉嶈亴璐ｃ€?
- 寮€鍙戝拰楠屾敹鐢ㄤ笉鍚?`contextDir`銆?
- 鍏变韩鐪熷疄涓氬姟鐩綍鏃剁粺涓€鏀惧埌 `workdir`銆?
- `codex` 鑺傜偣 prompt 閲屾樉寮忓啓娓?complete銆乫ail 涓ょ被缁堟€佸懡浠よЕ鍙戞潯浠躲€?
- 楠岃瘉绫昏妭鐐规妸鎶ュ憡鏂囦欢鍜屾渶缁?outcome 涓€璧蜂骇鍑猴紝閬垮厤鍙湁鑷劧璇█缁撹銆?
- `approval reject` 鐨?prompt 瑕佹槑纭姹備汉宸ョ粰鍑哄叿浣撴剰瑙併€?
- 涓€斿璇濅换鍔＄敤 `agent_session`銆?
- 涓€娆℃€у噯澶囪剼鏈敤 `shell`銆?

## 16. 杩愯鍏ュ彛

```bash
flowbraid validate path/to/workflow.yaml
flowbraid run path/to/workflow.yaml
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --no-interactive
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "琛ュ厖璇存槑"
flowbraid send <run-dir> "缁х画鎵ц"
```

## 17. 杩愯杈撳嚭

甯歌杈撳嚭锛?

```text
[run] started 20260506-123456-abcdef
[run] workspace D:\Code\FlowBraid\examples\.flowbraid-runs\20260506-123456-abcdef
[run] step 1: enter node develop (codex)
[run] node develop succeeded, next verify
[run] step 2: enter node verify (codex)
[run] paused at approve: Human confirmation is required
run 20260506-123456-abcdef => paused
workspace: D:\Code\FlowBraid\examples\.flowbraid-runs\20260506-123456-abcdef
```

## 18. 杩愯浜х墿

- `state/run.json`锛歳un 鎬荤姸鎬併€?
- `state/timeline.json`锛氭寜 step / attempt 璁板綍鐨勬椂闂寸嚎銆?
- `nodes/<node-id>/status.json`锛氬崟鑺傜偣鐘舵€併€?
- `nodes/<node-id>/state/runtime-state.json`锛氳妭鐐硅繍琛屾€佺湡婧愶紝鍖呭惈 status銆乷utcome銆乻ummary銆乤ttemptId 绛夈€?
- `messages/events.jsonl`锛氬叏灞€浜嬩欢娴併€?
- `messages/human-feedback.jsonl`锛氬鎵瑰弽棣堛€?
- `nodes/<node-id>/artifacts/`锛氳妭鐐硅緭鍑轰骇鐗┿€?
- `nodes/<node-id>/messages/inbox.jsonl`锛氫細璇濆瀷鑺傜偣杈撳叆銆?
- `nodes/<node-id>/messages/outbox.jsonl`锛氫細璇濆瀷鑺傜偣杈撳嚭銆?

