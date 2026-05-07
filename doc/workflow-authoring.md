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

椤跺眰缁撴瀯锛?

```yaml
id: your-workflow-id
start: first-node-id
workdir: ./shared-workdir
contextDir: ./default-context
nodes:
  ...
```

瀛楁璇存槑锛?

- `id`
  - 蹇呭～
  - 宸ヤ綔娴佸敮涓€鏍囪瘑
  - 蹇呴』鏄潪绌哄瓧绗︿覆

- `start`
  - 蹇呭～
  - 璧峰鑺傜偣 id
  - 蹇呴』寮曠敤 `nodes` 涓凡瀛樺湪鐨勮妭鐐?

- `workdir`
  - 鍙€?
  - workflow 绾ч粯璁や笟鍔＄洰褰?
  - 渚?`shell`銆乣codex`銆乣agent_session` 鑺傜偣缁ф壙
  - 涓虹┖瀛楃涓蹭細鏍￠獙澶辫触

- `contextDir`
  - 鍙€?
  - workflow 绾ч粯璁や笂涓嬫枃鐩綍
  - 渚?`shell`銆乣codex`銆乣agent_session` 鑺傜偣缁ф壙
  - 涓虹┖瀛楃涓蹭細鏍￠獙澶辫触

- `nodes`
  - 蹇呭～
  - 鑺傜偣瀛楀吀锛宬ey 灏辨槸鑺傜偣 id
  - 涓嶈兘涓虹┖

## 4. 鑺傜偣閫氱敤瀛楁

鎵€鏈夎妭鐐归兘鏀寔浠ヤ笅閫氱敤瀛楁锛?

- `id`
  - 鍙€?
  - 濡傛灉鍐欎簡锛屽繀椤诲拰鑺傜偣 key 瀹屽叏涓€鑷?
  - 涓€鑸笉鎺ㄨ崘鍐欙紝鐩存帴浣跨敤鑺傜偣 key 鍗冲彲

- `type`
  - 蹇呭～
  - 褰撳墠鏀寔锛?
    - `shell`
    - `codex`
    - `agent_session`
    - `gate`
    - `approval`
    - `end`

- `title`
  - 鍙€?
  - 褰撳墠涓昏浣滀负鎻忚堪瀛楁锛屼笉鍙備笌璋冨害

- `next`
  - 鍙€?
  - 榛樿涓嬩竴璺?
  - 甯哥敤浜庡崟涓€鎴愬姛璺緞

- `transitions`
  - 鍙€?
  - 鏄惧紡澹版槑鍒嗘敮璺宠浆
  - 鏀寔鐨?key锛?
    - `success`
    - `failure`
    - `default`
    - `approve`
    - `reject`

鎺ㄨ崘瑙勫垯锛?

- 鍙湁涓€涓甯稿悗缁ф椂锛岀敤 `next`
- 鏈夋垚鍔?澶辫触鍒嗘敮鏃讹紝鐢?`transitions.success` / `transitions.failure`
- `approval` 蹇呴』鐢?`transitions.approve` / `transitions.reject`

## 5. 鐩綍妯″瀷

FlowBraid 閲屾湁涓変釜瀹规槗娣锋穯鐨勭洰褰曟蹇碉細

- `run workspace`
  - FlowBraid 杩愯鏃剁洰褰?
  - 鐢ㄤ簬淇濆瓨鐘舵€併€佹秷鎭€佹棩蹇楀拰鑺傜偣浜х墿
  - 榛樿钀藉湪 workflow 鏂囦欢鎵€鍦ㄧ洰褰曚笅鐨?`.flowbraid-runs/`

- `contextDir`
  - 鑺傜偣缁堢榛樿鎵撳紑鐨勭洰褰?
  - 鐢ㄤ簬鏀?`AGENTS.md`銆佽鑹茶鏄庛€佸眬閮ㄧ害鏉?
  - 鏇村儚鈥滆韩浠界洰褰曗€濇垨鈥滆鑹茬洰褰曗€?

- `workdir`
  - 鑺傜偣鐪熷疄淇敼鍜岄獙璇佷笟鍔℃枃浠剁殑鐩綍
  - 澶氫釜鑺傜偣鍙互鍏变韩鍚屼竴涓?`workdir`
  - 鏇村儚鈥滅湡瀹炰笟鍔″伐浣滃尯鈥?

褰撳墠瀹炵幇涓殑榛樿瑙勫垯锛?

- 鑺傜偣 `workdir` 浼樺厛绾э細
  - 鑺傜偣绾?`workdir`
  - workflow 绾?`workdir`
  - CLI `--workdir`
  - workflow 鏂囦欢鎵€鍦ㄧ洰褰?

- 鑺傜偣 `contextDir` 浼樺厛绾э細
  - 鑺傜偣绾?`contextDir`
  - workflow 绾?`contextDir`
  - 褰撳墠鑺傜偣鏈€缁堣В鏋愬嚭鏉ョ殑 `workdir`

鎺ㄨ崘鐢ㄦ硶锛?

- 寮€鍙?楠屾敹鑺傜偣鍏变韩鍚屼竴涓?`workdir`
- 寮€鍙戣妭鐐逛娇鐢ㄨ嚜宸辩殑 `contextDir`
- 楠屾敹鑺傜偣浣跨敤鑷繁鐨?`contextDir`
- 涓嶈鎶婅鑹茶鏄庡拰鐪熷疄涓氬姟鏂囦欢娣峰湪涓€璧?

## 6. `shell` 鑺傜偣

绀轰緥锛?

```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

瀛楁锛?

- `type: shell`
- `command`
  - 蹇呭～
  - 闈炵┖瀛楃涓?
- `cwd`
  - 鍙€?
  - 鐢ㄤ簬瑕嗙洊 shell 杩涚▼褰撳墠鐩綍
  - 濡傛灉鏈啓锛岄粯璁や娇鐢ㄨ鑺傜偣鐨?`contextDir`
- `workdir`
  - 鍙€?
- `contextDir`
  - 鍙€?

杩愯璇箟锛?

- 鍛戒护閫€鍑虹爜涓?`0` 鏃惰涓烘垚鍔?
- 闈?`0` 鏃惰涓哄け璐?
- 濡傛灉閰嶇疆浜?`transitions.failure`锛屼細杩涘叆澶辫触鍒嗘敮
- 鍚﹀垯鏁翠釜 run 澶辫触

鎺ㄨ崘鐢ㄦ硶锛?

- 鐢ㄤ簬鍑嗗鐜銆佹竻鐞嗙洰褰曘€佹墽琛屼竴娆℃€ц剼鏈?
- 澶氳鍛戒护浼樺厛鐢?YAML 鍧楀瓧绗︿覆

绀轰緥锛?

```yaml
command: |
  node -e "
  console.log('prepare')
  "
```

## 7. `codex` 鑺傜偣

绀轰緥锛?

```yaml
develop:
  type: codex
  mode: exec
  contextDir: ./demo-dev
  workdir: ./demo-workdir
  prompt: |
    Read AGENTS.md first, then implement the task.
  outputFile: develop-last-message.md
  transitions:
    success: verify
    failure: verify
```

瀛楁锛?

- `type: codex`
- `mode`
  - 蹇呭～
  - 鍙兘鏄細
    - `exec`
    - `review`
- `prompt`
  - 蹇呭～
  - 闈炵┖瀛楃涓?
- `cwd`
  - 鍙€?
  - 榛樿浣跨敤璇ヨ妭鐐圭殑 `contextDir`
- `workdir`
  - 鍙€?
- `contextDir`
  - 鍙€?

### `reentry`

`codex` 节点支持可选的 `reentry` 配置，用于控制同一次 workflow run 内再次进入该节点时，FlowBraid 应该如何打开终端。

```yaml
develop:
  type: codex
  mode: exec
  prompt: |
    Implement the task.
  reentry:
    mode: resume
```

支持的取值：

- `resume`
  - 默认值
  - 如果该节点上一轮已经记录了 `sessionId`，则使用 `codex resume <sessionId>` 恢复原会话
  - 如果当前没有可恢复的 `sessionId`，会退化为 `new_with_history`

- `new_with_history`
  - 新开会话
  - 但会把最新验证结果、人工反馈和工作流回流上下文作为提示词补给新会话

- `new`
  - 新开会话
  - 不主动拼接上一轮验证/反馈历史，只保留当前轮必要的工作流引导和协议说明

补充说明：

- `reentry` 当前只对 `codex` 节点生效
- `agent_session` 节点本身就是长期会话模型，不使用这个字段
- native split 模式下，主进程会在节点启动后主动探测并记录该节点自己的 `sessionId`
- 记录位置包括：
  - `nodes/<node-id>/state/native-session.json`
  - `nodes/<node-id>/status.json`- `model`
  - 鍙€?
  - 浼犵粰 `codex` CLI
- `outputFile`
  - 鍙€?
  - 鑺傜偣浜х墿鏂囦欢鍚?
  - 榛樿鏄?`codex-last-message.md`

杩愯璇箟锛?

- `mode: exec`
  - 鐢ㄤ簬寮€鍙戙€佷慨鏀广€佺敓鎴愩€佹墽琛屼竴娆℃€т换鍔?
- `mode: review`
  - 鐢ㄤ簬楠屾敹鍜屽鏌?
  - 缁撴灉涓嶄粎渚濊禆 CLI 鏄惁鎴愬姛閫€鍑猴紝杩樹緷璧栬緭鍑轰腑鏄惁鍖呭惈锛?
    - `verdict: approve`
    - `verdict: reject`

褰撳墠鎺ㄨ崘瑙勫垯锛?

- 寮€鍙戣妭鐐圭敤 `mode: exec`
- 楠屾敹鑺傜偣鐢?`mode: review`
- `review` 鑺傜偣鐨?`prompt` 閲屾槑纭姹傝緭鍑?`verdict: approve|reject`
- `review reject` 鏃堕厤 `transitions.failure` 鍥炴祦鍒板紑鍙戣妭鐐?

閲嶈璇存槑锛?

- 褰撳墠瀹炵幇閲岋紝`codex` 鏍囧噯妯″紡銆乻plit-terminal 妯″紡銆乶ative-split 妯″紡閮介伒寰悓涓€濂?success/failure 璺宠浆璇箟
- `codex` 鑺傜偣澶辫触鏃讹紝濡傛灉澹版槑浜?`transitions.failure`锛屼細缁х画璧板け璐ュ垎鏀?

## 8. `agent_session` 鑺傜偣

绀轰緥锛?

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

瀛楁锛?

- `type: agent_session`
- `provider`
  - 蹇呭～
  - 褰撳墠鍙敮鎸?`codex`
- `prompt`
  - 蹇呭～
  - 闈炵┖瀛楃涓?
- `cwd`
  - 鍙€?
- `workdir`
  - 鍙€?
- `contextDir`
  - 鍙€?
- `model`
  - 鍙€?
- `outputFile`
  - 鍙€?

杩愯璇箟锛?

- 杩欐槸闀挎湡浜や簰鑺傜偣锛屼笉鏄竴娆℃€ф墽琛岃妭鐐?
- provider 姣忔鍙仛涓€杞?turn
- provider 杩斿洖涓夌缁撴瀯鍖栫姸鎬佷箣涓€锛?
  - `waiting_input`
  - `completed`
  - `failed`

瀵瑰簲琛屼负锛?

- `waiting_input`
  - 褰撳墠 run 杩涘叆 `paused`
  - 蹇呴』閫氳繃 `flowbraid send <run-dir> <message>` 缁х画
  - 涓嶄娇鐢?`resume`

- `completed`
  - 鑺傜偣鎴愬姛锛岀户缁笅涓€璺?

- `failed`
  - 鑺傜偣澶辫触
  - 濡傛灉閰嶇疆浜?`transitions.failure`锛岃繘鍏ュけ璐ュ垎鏀?

鎺ㄨ崘鐢ㄦ硶锛?

- 鐢ㄤ簬闇€姹傛緞娓呫€侀暱鏈熶細璇濄€侀€愯疆浜や簰浠诲姟
- 涓嶈鎶婁竴娆℃€у紑鍙戜换鍔″己琛屽啓鎴?`agent_session`

## 9. `gate` 鑺傜偣

绀轰緥锛?

```yaml
checkpoint:
  type: gate
  prompt: |
    Check the generated files, then continue.
  next: next-step
```

瀛楁锛?

- `type: gate`
- `prompt`
  - 鍙€?

杩愯璇箟锛?

- 杩涘叆璇ヨ妭鐐瑰悗锛宺un 浼氭殏鍋?
- 閫氳繃 `flowbraid resume <run-dir>` 缁х画
- 缁х画鍚庢祦鍚戯細
  - `transitions.default`
  - 鍚﹀垯 `next`

閫傚悎鍦烘櫙锛?

- 浜哄伐纭
- 鎵嬪姩妫€鏌?
- 澶栭儴鏉′欢绛夊緟

## 10. `approval` 鑺傜偣

绀轰緥锛?

```yaml
approve:
  type: approval
  prompt: |
    Human confirmation is required.
  transitions:
    approve: done
    reject: develop
```

瀛楁锛?

- `type: approval`
- `prompt`
  - 鍙€?
- `transitions.approve`
  - 蹇呭～
- `transitions.reject`
  - 蹇呭～

杩愯璇箟锛?

- 杩涘叆璇ヨ妭鐐瑰悗锛宺un 浼氭殏鍋?
- 蹇呴』閫氳繃 `flowbraid resume <run-dir> --decision approve|reject` 缁х画
- 濡傛灉 `reject`锛屽綋鍓嶅疄鐜拌姹傛彁渚?comment
- 浜哄伐鍙嶉浼氳璁板綍鍒?`messages/human-feedback.jsonl`

鎺ㄨ崘鐢ㄦ硶锛?

- 鐢ㄤ簬鐪熸鐨勪汉宸ュ鎵?
- 濡傛灉鍙槸鈥滄寜鍥炶溅缁х画鈥濓紝璇风敤 `gate`

## 11. `end` 鑺傜偣

绀轰緥锛?

```yaml
done:
  type: end
  message: workflow completed
```

瀛楁锛?

- `type: end`
- `message`
  - 鍙€?

杩愯璇箟锛?

- 鍒拌揪鍚庡伐浣滄祦缁撴潫

## 12. 鍒嗘敮瑙勫垯

褰撳墠璺宠浆浼樺厛绾э細

鏅€氳妭鐐癸細

1. 濡傛灉鏍规嵁缁撴灉鍛戒腑浜?`transitions.success` 鎴?`transitions.failure`锛屼紭鍏堣蛋瀵瑰簲鍒嗘敮
2. 鍚﹀垯濡傛灉瀛樺湪 `transitions.default`锛岃蛋 `default`
3. 鍚﹀垯濡傛灉瀛樺湪 `next`锛岃蛋 `next`
4. 鍚﹀垯缁撴潫褰撳墠閾捐矾锛涜嫢鑺傜偣鏄け璐ユ€侊紝鍒欐暣涓?run 澶辫触

`approval` 鑺傜偣锛?

1. `approve` 璧?`transitions.approve`
2. `reject` 璧?`transitions.reject`

## 13. 鎺ㄨ崘缂栨帓妯″紡

### 妯″紡 A锛氬噯澶?-> 寮€鍙?-> 楠屾敹 -> 浜哄伐瀹℃壒 -> 缁撴潫

杩欐槸鏈€鎺ㄨ崘鐨勬爣鍑嗛棴鐜細

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
    mode: exec
    contextDir: ./demo-dev
    workdir: ./demo-workdir
    prompt: |
      Implement the task.
    next: verify

  verify:
    type: codex
    mode: review
    contextDir: ./demo-verify
    workdir: ./demo-workdir
    prompt: |
      Verify the task.
      Output verdict: approve or verdict: reject.
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

### 妯″紡 B锛氶暱鏈熶細璇?-> 缁撴潫

```yaml
id: session-demo
start: discuss
nodes:
  discuss:
    type: agent_session
    provider: codex
    prompt: |
      Ask clarifying questions first.
    next: done

  done:
    type: end
```

## 14. 甯歌閿欒

### 1. `start` 鎸囧悜涓嶅瓨鍦ㄨ妭鐐?

浼氱洿鎺ユ牎楠屽け璐ャ€?

### 2. `approval` 缂哄皯 `approve` 鎴?`reject`

浼氱洿鎺ユ牎楠屽け璐ャ€?

### 3. `agent_session` 鐢?`resume`

杩欐槸閿欒鐢ㄦ硶銆俙agent_session` 搴旇鐢?`send`锛屼笉鏄?`resume`銆?

### 4. `review` 鑺傜偣涓嶈緭鍑?`verdict:`

褰撳墠瀹炵幇浼氭妸瀹冭涓哄け璐ワ紝涓嶄細褰撲綔鎴愬姛閫氳繃銆?

### 5. 鎶?`contextDir` 褰撲綔鐪熷疄涓氬姟鐩綍

鎺ㄨ崘鍙妸瀹冨綋瑙掕壊鐩綍銆傜湡瀹炰唬鐮佷慨鏀瑰簲璇ヨ惤鍦?`workdir`銆?

### 6. 鍦ㄥ崟琛?YAML 閲岀‖濉炲鏉?shell 鍛戒护

澶嶆潅鍛戒护鎺ㄨ崘浣跨敤鍧楀瓧绗︿覆銆?

### 7. 娌℃湁澶辫触鍒嗘敮鍗存湡鏈涜嚜鍔ㄥ洖娴?

褰撳墠鍙湁鏄惧紡閰嶇疆浜?`transitions.failure`锛屽け璐ユ椂鎵嶄細缁х画鍒嗘敮娴佽浆銆?

## 15. 鎺ㄨ崘瀹炶返

- 姣忎釜鑺傜偣鍙仛涓€绉嶈亴璐?
- 寮€鍙戝拰楠屾敹鐢ㄤ笉鍚?`contextDir`
- 鍏变韩鐪熷疄涓氬姟鐩綍鏃剁粺涓€鏀惧埌 `workdir`
- `review` 鑺傜偣鏄庣‘瑕佹眰杈撳嚭 `verdict:`
- `approval reject` 鐨?prompt 鏄庣‘瑕佹眰浜哄伐缁欏嚭鍏蜂綋鎰忚
- 瀵归渶瑕佷腑閫斿璇濈殑鑺傜偣浣跨敤 `agent_session`
- 瀵逛竴娆℃€у噯澶囪剼鏈娇鐢?`shell`

## 16. 鍙傝€冩枃浠?

鎺ㄨ崘浠庝互涓嬫枃浠剁户缁湅锛?

- 鏍囧噯鍘熺敓鍒嗙缁堢绀轰緥锛歔codex-native-split-demo.workflow.yaml](D:/Code/FlowBraid/examples/codex-native-split-demo.workflow.yaml:1)
- PTY 浜や簰绀轰緥锛歔codex-pty-demo.workflow.yaml](D:/Code/FlowBraid/examples/codex-pty-demo.workflow.yaml:1)
- 闀挎湡浼氳瘽绀轰緥锛歔agent-session-demo.workflow.yaml](D:/Code/FlowBraid/examples/agent-session-demo.workflow.yaml:1)
- 闇€姹備笌鐘舵€佹ā鍨嬶細[requirements.md](D:/Code/FlowBraid/doc/requirements.md:18)
- 鏋舵瀯涓庤繍琛屾祦绋嬶細[architecture.md](D:/Code/FlowBraid/doc/architecture.md:31)

## 17. 濡備綍鍚姩鍜岃繍琛屽伐浣滄祦

### 17.1 鏍￠獙 workflow 鏂囦欢

鍦ㄦ寮忚繍琛屽墠锛屽缓璁厛鏍￠獙锛?

```bash
flowbraid validate path/to/workflow.yaml
```

鏍￠獙閫氳繃鏃朵細杈撳嚭锛?

```text
workflow 鏍￠獙閫氳繃
```

閫傚悎鐢ㄦ潵鎻愬墠鍙戠幇锛?

- `start` 鎸囧悜涓嶅瓨鍦ㄨ妭鐐?
- 鑺傜偣 `type` 闈炴硶
- `approval` 缂哄皯 `approve` / `reject`
- 璺宠浆鐩爣涓嶅瓨鍦?

### 17.2 鍚姩宸ヤ綔娴?

鍩虹鍛戒护锛?

```bash
flowbraid run path/to/workflow.yaml
```

甯歌鍙傛暟锛?

```bash
flowbraid run path/to/workflow.yaml --workspace <runs-dir> --workdir <dir> --codex-command <cmd>
```

瀛楁璇存槑锛?

- `--workspace <dir>`
  - 鎸囧畾 run workspace 鐨勬牴鐩綍
  - 榛樿鏄?workflow 鏂囦欢鎵€鍦ㄧ洰褰曚笅鐨?`.flowbraid-runs/`

- `--workdir <dir>`
  - 瑕嗙洊 workflow 榛樿 `workdir`
  - 閫傚悎鍚屼竴浠?workflow 鍦ㄤ笉鍚屼笟鍔＄洰褰曚腑澶嶇敤

- `--codex-command <cmd>`
  - 鎸囧畾 `codex` 鍛戒护鍏ュ彛
  - 渚嬪鏈湴鍖呰鑴氭湰銆佹祴璇曟々鎴栬嚜瀹氫箟鍚姩鍛戒护

### 17.3 浜や簰妯″紡涓庡垎绂荤粓绔ā寮?

濡傛灉褰撳墠缁堢鏄?TTY锛宍run` 榛樿浼氳繘鍏ヤ氦浜掑紡杩愯銆?

甯歌妯″紡锛?

```bash
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --interactive
```

璇存槑锛?

- `--interactive`
  - 鍏佽鍦ㄥ綋鍓嶇粓绔腑澶勭悊瀹℃壒銆侀棬绂佸拰浼氳瘽缁х画杈撳叆

  - `codex` 鑺傜偣浣跨敤鏃х殑 helper 鍖呰９鍨嬪垎绂荤粓绔ā寮?

- ???????????????native split?
  - `codex` 鑺傜偣浣跨敤鍘熺敓 `codex` 鍒嗙缁堢妯″紡
  - 涓昏繘绋嬬户缁暀鍦ㄥ綋鍓嶇粓绔緭鍑烘祦绋嬫棩蹇?
  - 姣忎釜 `codex` 鑺傜偣鍦ㄧ嫭绔嬬獥鍙ｄ腑杩愯

### 17.4 闈炰氦浜掓ā寮?

濡傛灉浣犲湪鑴氭湰鎴?CI 涓繍琛岋紝鎴栬€呮槑纭笉鎯宠繘鍏ヤ氦浜掓ā寮忥紝鍙互鍏抽棴锛?

```bash
flowbraid run path/to/workflow.yaml --no-interactive
```

姝ゆ椂濡傛灉娴佺▼鍋滃湪锛?

- `gate`
- `approval`
- `agent_session` 鐨?`waiting_input`

灏遍渶瑕佸悗缁€氳繃 `resume` 鎴?`send` 鎵嬪姩缁х画銆?

## 18. 濡備綍缁х画銆佹帶鍒跺拰鎭㈠宸ヤ綔娴?

### 18.1 `resume`

鐢ㄤ簬缁х画锛?

- `gate`
- `approval`

鍛戒护锛?

```bash
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "鍏蜂綋鎵撳洖鎰忚"
```

璇存槑锛?

- `gate` 鑺傜偣鍙渶瑕?`resume`
- `approval` 鑺傜偣蹇呴』缁欏嚭 `approve` 鎴?`reject`
- `reject` 鏃跺繀椤诲甫 `--message`

### 18.2 `send`

鐢ㄤ簬缁х画锛?

- `agent_session`

鍛戒护锛?

```bash
flowbraid send <run-dir> "缁х画娑堟伅"
```

璇存槑锛?

- `agent_session` 涓嶄娇鐢?`resume`
- `send` 浼氭妸娑堟伅鍐欏叆褰撳墠浼氳瘽鑺傜偣鐨?`inbox.jsonl`
- provider 浼氬熀浜庡畬鏁翠細璇濆巻鍙茬户缁笅涓€杞?turn

### 18.3 涓柇杩愯

杩愯涓寜 `Ctrl+C`锛?

- 绗竴娆★細璇锋眰涓昏繘绋嬬粓姝㈠綋鍓嶈繍琛岋紝骞跺敖閲忔妸澶辫触鐘舵€佽惤鐩?
- 杩炵画鍐嶆鎸夛細鐩存帴寮哄埗閫€鍑哄綋鍓?CLI 杩涚▼

寤鸿锛?

- 濡傛灉宸茬粡鎷垮埌 `run-dir`锛屼紭鍏堟煡鐪嬬姸鎬佹枃浠剁‘璁や腑鏂偣
- 涓嶈鍋囪鎵€鏈夊閮ㄥ瓙杩涚▼閮戒細鐬椂閫€鍑?

## 19. 甯哥敤鍛戒护閫熸煡

```bash
flowbraid validate path/to/workflow.yaml
flowbraid run path/to/workflow.yaml
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --interactive
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "璇疯ˉ鍏呴敊璇鐞?
flowbraid send <run-dir> "璇风户缁疄鐜板鍑哄姛鑳?
```

## 20. 濡備綍鐞嗚В杩愯杈撳嚭

涓昏繘绋嬪父瑙佽緭鍑虹ず渚嬶細

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

甯歌鍓嶇紑鍚箟锛?

- `[run]`
  - 璋冨害鍣ㄧ骇鍒棩蹇?
  - 琛ㄧず run 鐘舵€佸彉鍖栥€佽妭鐐硅繘鍏ャ€佽妭鐐规祦杞?

- `[<node-id>]`
  - 鏉ヨ嚜鍏蜂綋鑺傜偣鎵ц杩囩▼鐨勬棩蹇?
  - 渚嬪 `shell` 杈撳嚭銆乣codex` 杈撳嚭銆乸rovider 杈撳嚭

- `[native]`
  - 鍘熺敓鍒嗙缁堢妯″紡涓嬬殑鑺傜偣绐楀彛鍚姩銆佷細璇濇仮澶嶃€佺粓绔叧闂瓑鏃ュ織

甯歌鐘舵€佽В閲婏細

- `started`
  - run 宸插垱寤哄苟寮€濮嬫墽琛?

- `workspace <dir>`
  - 鏈 run 鐨勮繍琛岀洰褰?
  - 鍚庣画 `resume` / `send` 閮藉熀浜庤繖涓洰褰?

- `step N: enter node ...`
  - 璋冨害鍣ㄨ繘鍏ョ N 姝?

- `node ... succeeded`
  - 鑺傜偣鎴愬姛缁撴潫

- `node ... failed`
  - 鑺傜偣澶辫触
  - 濡傛灉鏃ュ織閲岃繕鏈?`route to ...`锛岃鏄庡け璐ュ悗杩涘叆浜?`transitions.failure`

- `paused at ...`
  - 娴佺▼鏆傚仠
  - 闇€瑕佷綘鎵嬪姩缁х画

- `run ... => completed`
  - 鏁翠釜宸ヤ綔娴佸畬鎴?

- `run ... => failed`
  - 鏁翠釜宸ヤ綔娴佸け璐?

## 21. 濡備綍鏌ョ湅杩愯浜х墿鍜岀姸鎬?

姣忔杩愯閮戒細鍒涘缓鐙珛 run 鐩綍銆?

鍏抽敭鏂囦欢锛?

- `state/run.json`
  - run 鎬荤姸鎬?

- `nodes/<node-id>/status.json`
  - 鍗曡妭鐐圭姸鎬?

- `messages/events.jsonl`
  - 鍏ㄥ眬浜嬩欢娴?

- `messages/human-feedback.jsonl`
  - 瀹℃壒 reject / approve 鍙嶉

- `nodes/<node-id>/artifacts/`
  - 鑺傜偣杈撳嚭浜х墿

- `nodes/<node-id>/messages/inbox.jsonl`
  - 浼氳瘽鍨嬭妭鐐硅緭鍏?

- `nodes/<node-id>/messages/outbox.jsonl`
  - 浼氳瘽鍨嬭妭鐐硅緭鍑?

瀹氫綅鎬濊矾锛?

- 鎯崇煡閬?run 鍋滃湪鍝細鐪?`state/run.json`
- 鎯崇煡閬撴煇鑺傜偣涓轰粈涔堝け璐ワ細鐪?`nodes/<node-id>/status.json`
- 鎯崇煡閬撳鎵圭粰浜嗕粈涔堟剰瑙侊細鐪?`messages/human-feedback.jsonl`
- 鎯崇煡閬?review 涓轰粈涔?reject锛氱湅瀵瑰簲 `artifacts/*.md`


