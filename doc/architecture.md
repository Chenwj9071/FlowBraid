# FlowBraid 鏋舵瀯璇存槑

## 鎬讳綋缁撴瀯
FlowBraid 褰撳墠鎷嗘垚鍥涘眰锛?
- 宸ヤ綔娴佸畾涔夊眰锛氳鍙栥€佽В鏋愩€佹牎楠?workflow 鏂囦欢銆?
- 璋冨害灞傦細椹卞姩鑺傜偣鎵ц锛屽鐞嗘殏鍋溿€佸鎵广€佸洖娴併€乣resume` 鍜?`send`銆?
- 鎵ц鍣ㄤ笌 provider 灞傦細璐熻矗鐪熸鎷夎捣 `shell`銆乣codex` 浠诲姟鑺傜偣锛屼互鍙婁細璇濆瀷 provider 鐨勫崟娆?turn銆?
- 杩愯鏃跺瓨鍌ㄥ眰锛氳礋璐?run workspace銆佺姸鎬佹枃浠躲€佹秷鎭銆佹棩蹇楀拰浜х墿銆?

## 鍏抽敭妯″潡
### 1. Workflow Loader
- 璇诲彇 YAML/JSON銆?
- 瑙勮寖鍖栬妭鐐瑰畾涔夈€?
- 鏍￠獙璧风偣銆佽妭鐐瑰紩鐢ㄥ拰璺宠浆鍏崇郴銆?
- 褰撳墠鑺傜偣绫诲瀷鍖呮嫭 `shell`銆乣codex`銆乣agent_session`銆乣gate`銆乣approval`銆乣end`銆?
- 鏍￠獙 workflow 绾у拰鑺傜偣绾х殑 `workdir` / `contextDir` 閰嶇疆銆?

### 2. Run Workspace
- 姣忔杩愯鍒涘缓鐙珛鐩綍銆?
- 鐩綍鍐呭寘鍚?`manifest`銆乣state`銆乣nodes`銆乣artifacts`銆乣messages` 鍜?`logs`銆?
- 鑺傜偣鐩綍鍜屽伐绋嬬洰褰曚弗鏍煎垎绂汇€?
- 榛樿鎯呭喌涓嬶紝workflow 鏂囦欢鎵€鍦ㄧ洰褰曞氨鏄粯璁ゅ伐浣滅洰褰曪紝`.flowbraid-runs/` 涔熻惤鍦ㄨ鐩綍涓嬨€?

### 3. Scheduler
- 鎸夊浘缁撴瀯椹卞姩鑺傜偣鎵ц銆?
- 鑺傜偣鎴愬姛銆佸け璐ャ€佹殏鍋滈兘瑕佸啓鍏ョ姸鎬佹枃浠躲€?
- `gate` / `approval` 鏄繍琛屾椂涓€绛夌姸鎬侊紝涓嶆槸鑴氭湰澶栫疆閫昏緫銆?
- `agent_session` 鑺傜偣鏆傚仠鏃朵笉浼氬垏鍒?`pendingNodeId`锛岃€屾槸淇濇寔 `currentNodeId` 鎸囧悜褰撳墠浼氳瘽鑺傜偣锛岀瓑寰?`send`銆?
- 鑺傜偣澶辫触鏃跺鏋滈厤缃簡 `transitions.failure`锛岃皟搴﹀櫒浼氫繚鐣欒鑺傜偣鐨勫け璐ョ姸鎬侊紝骞剁户缁祦杞埌澶辫触鍒嗘敮鑺傜偣銆?

### 4. Executors And Providers
- `shell` 鎵ц鍣ㄨ礋璐ｄ竴娆℃€ф湰鍦板懡浠ゃ€?
- `codex` 浠诲姟鑺傜偣璐熻矗鐭敓鍛藉懆鏈熶换鍔★紝鎺ㄨ崘閫氳繃 `flowbraid node complete|fail` 鎶婄粨鏋滃啓鍥炶繍琛屾€併€?
- 璋冨害鍣ㄤ紭鍏堣鍙栧綋鍓?attempt 鐨?`runtime-state.json` 鍜?outcome 浜嬩欢鍐冲畾 `codex` 鑺傜偣娴佽浆銆?
- 旧的 `mode: review` / `verdict` 仅作为历史兼容说明，不再是主路径设计。
- `codex` 鐨勫紑鍙戞ā寮忓湪浜や簰杩愯鏃堕€氳繃 PTY 鐩撮€氬綋鍓嶇粓绔紝杈撳叆杈撳嚭閮借蛋鍚屼竴鏉?terminal 閫氶亾銆?
- Windows 涓嬬殑 PTY 浜や簰閾捐矾浼氬厛鍒囧埌 UTF-8 鎺у埗鍙帮紝鍐嶅惎鍔?`codex`锛屽噺灏戜腑鏂囪鑹叉枃妗ｅ拰浜哄伐杈撳叆鐨勪贡鐮侀棶棰樸€?
- `agent_session` 鑺傜偣涓嶅啀鎶娾€滆繘绋嬮€€鍑衡€濆綋浣滆妭鐐瑰畬鎴愪俊鍙凤紝鑰屾槸璋冪敤 provider 鍋氫竴娆?turn锛屾秷璐瑰畬鏁翠細璇濆巻鍙插苟杩斿洖缁撴瀯鍖栫粨鏋溿€?
- 褰撳墠 provider 鍙惤鍦?`codex`锛屼絾鎺ュ彛杈圭晫宸茬粡鎸?`agent_session` 鎷嗗紑锛屽悗缁彲浠ユ帴 `claude` 绛夊叾浠?provider銆?

### 5. State And Messaging
- `state/run.json`锛歳un 绾х姸鎬併€?
- `state/timeline.json`锛氭寜鑺傜偣 step / attempt 鎸佷箙鍖栫殑鏃堕棿绾裤€?
- `nodes/<node-id>/status.json`锛氳妭鐐圭骇鐘舵€併€?
- `nodes/<node-id>/state/runtime-state.json`锛氫换鍔″瀷鑺傜偣杩愯鎬侊紝鍖呭惈 status銆乷utcome銆乻ummary銆乤ttemptId銆乼erminalPid 绛夈€?
- `messages/events.jsonl`锛氬叏灞€杩愯浜嬩欢銆?
- `messages/human-feedback.jsonl`锛氫汉宸ュ鎵圭殑 reject / approve 缁撴灉鍜屽弽棣堟剰瑙併€?
- `nodes/<node-id>/messages/inbox.jsonl`锛氫細璇濊妭鐐圭殑 system / user 杈撳叆銆?
- `nodes/<node-id>/messages/outbox.jsonl`锛氫細璇濊妭鐐圭殑 assistant 鍥炲鍜岀粨鏋勫寲浜嬩欢銆?
- `nodes/<node-id>/state/session.json`锛氫細璇濊妭鐐圭姸鎬侊紝濡?`running`銆乣waiting_input`銆乣completed`銆乣failed`銆?
- `nodes/<node-id>/artifacts/session-turn-result.json`锛氭渶杩戜竴娆?provider turn 鐨勭粨鏋勫寲杈撳嚭銆?

## 鍙岀洰褰曡妭鐐规ā鍨?
- `contextDir` 鏄妭鐐圭粓绔粯璁ゆ墦寮€鐨勭洰褰曪紝鐢ㄤ簬瀹氫箟韬唤銆佽鑹层€佽涓哄噯鍒欏拰灞€閮ㄨ鏄庛€?
- `workdir` 鏄叡浜笟鍔＄洰褰曪紝鐢ㄤ簬鏀剧疆鐪熸鍗忎綔淇敼鐨勪笟鍔℃枃浠躲€?
- FlowBraid 浼氭妸 `contextDir` 浣滀负缁堢鍚姩鐩綍锛屽苟鎶?`workdir` 閫氳繃鍙傛暟鍜岀幆澧冨彉閲忔樉寮忎紶缁欐墽琛屽櫒銆?
- `codex` / `agent_session` 鍦ㄥ惎鍔ㄦ椂鍚屾椂鎷垮埌涓ょ被鐩綍锛?
  - `-C <contextDir>`锛氫粠瑙掕壊鐩綍鎵撳紑缁堢鍜岃鍙栧眬閮ㄧ害鏉熴€?
  - `--cd <workdir>`锛氬湪鍏变韩涓氬姟鐩綍閲屾墽琛岀湡瀹炰慨鏀瑰拰楠岃瘉銆?
- 涓嶅悓鑺傜偣鍙互浣跨敤涓嶅悓鐨?`contextDir`锛屼絾鎸囧悜鍚屼竴涓?`workdir`锛屼粠鑰屽疄鐜扳€滆韩浠介殧绂?+ 涓氬姟鍗忎綔鈥濄€?

## 棣栫増杩愯娴佺▼
1. 璇诲彇 workflow 鏂囦欢銆?
2. 鏍￠獙 workflow 鍥剧粨鏋勫拰鐩綍閰嶇疆銆?
3. 浠?workflow 鏂囦欢鎵€鍦ㄧ洰褰曚綔涓洪粯璁ゅ伐浣滅洰褰曪紝骞跺湪璇ョ洰褰曚笅鍒涘缓 run workspace銆?
4. 浠?`start` 鑺傜偣寮€濮嬫墽琛屻€?
5. `shell` 鑺傜偣杩愯瀹屾垚鍚庤繘鍏ヤ笅涓€璺炽€?
6. `codex` 浠诲姟鑺傜偣鍚姩鍚庯紝鍦?prompt 涓幏寰楁槑纭殑 complete / fail 涓婃姤鍗忚銆?
7. 璋冨害鍣ㄤ紭鍏堣鍙栧綋鍓?attempt 鐨?`runtime-state` 涓?outcome 浜嬩欢鍐冲畾鎴愬姛銆佸け璐ユ垨鏆傚仠銆?
8. 只有在历史兼容 workflow 且未拿到 runtime-state 终态时，调度器才回退到旧的退出码或 `review verdict` 解析。
9. `agent_session` 鑺傜偣浼氬厛璇诲彇瀹屾暣浼氳瘽鍘嗗彶锛屽啀璋冪敤 provider 鍋氫竴娆?turn銆?
10. 濡傛灉 turn 缁撴灉鏄?`waiting_input`锛宺un 杩涘叆 `paused`锛屽綋鍓嶈妭鐐逛繚鎸佷笉鍙橈紝绛夊緟 `flowbraid send` 鎴栦氦浜掓ā寮忎笅缁х画杈撳叆銆?
11. 濡傛灉 turn 缁撴灉鏄?`completed`锛岃皟搴﹀櫒鎸?`next` / `transitions.success` 娴佽浆鍒颁笅涓€涓妭鐐广€?
12. `approval` 鑺傜偣鍦?`resume` 鏃舵秷璐?`approve` / `reject` 鍐崇瓥銆?
13. 閬囧埌 `end` 鑺傜偣鍚庣粨鏉熻繍琛屻€?

## 褰撳墠璁捐鍙栬垗
- `codex` 浠诲姟鑺傜偣鍜?`agent_session` 鑺傜偣骞跺瓨锛岃€屼笉鏄己琛屽悎骞躲€傝繖鏄负浜嗛伩鍏嶆妸鐭换鍔¤涔夊拰闀挎湡浼氳瘽璇箟娣峰湪涓€涓€€鍑哄崗璁噷銆?
- `codex` 主路径优先使用通用 outcome 协议，而不是把 review 专用语义扩散到所有任务节点。
- 浼氳瘽鍨嬭妭鐐逛紭鍏堣蛋鏂囦欢鍗忚鍜岀粨鏋勫寲缁撴灉锛屼笉闈犺В鏋愯嚜鐒惰瑷€杈撳嚭鐚滄祴鈥滀换鍔℃槸鍚﹀畬鎴愨€濄€?
- PTY 鍙敤浜庢彁鍗囦氦浜掍綋楠岋紝涓嶆壙鎷呰妭鐐瑰畬鎴愬垽瀹氳亴璐ｃ€?
- 姝ｅ紡绀轰緥浼樺厛浣跨敤鑻辨枃瑙掕壊鎻愮ず鍜屾湰鍦?demo 鏂囨。锛屼互闄嶄綆 Windows PTY 涓嬩腑鏂囪緭鍑轰贡鐮佺殑姒傜巼銆?

## 琛ュ厖璁捐锛?026-05-06锛?
- native split 涓嬬殑 `codex` 鑺傜偣鍥炴祦绛栫暐鐢辫妭鐐圭骇 `reentry.mode` 鎺у埗锛岄粯璁ゅ€间负 `resume`銆?
- 璋冨害鍣ㄥ湪鍚姩 native codex 缁堢鍚庯紝浼氬熀浜?`workdir + startedAt` 涓诲姩鎺㈡祴鏂颁骇鐢熺殑 `codex` `sessionId`锛屽苟鍐欏叆 `nodes/<node-id>/state/native-session.json` 涓?`nodes/<node-id>/status.json`銆?
- 鍥炴祦鍒板悓涓€涓?`codex` 鑺傜偣鏃讹紝鍙厑璁镐娇鐢ㄨ鑺傜偣鑷繁鏈€杩戜竴娆℃寔涔呭寲鐨?`sessionId` 鎭㈠锛岀姝㈡牴鎹叡浜?`workdir` 鎺ㄦ柇鍏朵粬鑺傜偣浼氳瘽銆?

