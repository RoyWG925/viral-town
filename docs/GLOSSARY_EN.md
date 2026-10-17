# VIRAL — English glossary (the game ships in English)

One source of truth for names and recurring terms, so every file says the same thing. Tone: warm, small-town,
a little comic; short sentences; British-or-American is fine but be consistent within a file (use American).

## Town, places, festival
| 中文 | English |
|---|---|
| 霧港鎮 | Mistport |
| 燈籠節 | the Lantern Festival (short: the festival) |
| 慶典舞台 | the festival stage |
| 中央廣場 / 廣場 | the plaza |
| 布告欄 | the notice board |
| 鎮公所 | the town hall |
| 霧港新聞社 / 新聞部落格 | Mistport News / the news blog |
| 阿德麵包店 | Barney's Bakery |
| 美玲花店 | Daisy's Flowers |
| 咖啡廳 | the café |
| 警察局 | the police station |
| 章魚燒攤 | the takoyaki stall |
| 港口 | the harbor |
| 攤商 | stall owners |
| 攤位費 | the stall fee |
| 鴿子 / 白鴿 / 鴿籠 | pigeons / white doves (the festival ones) / dove cages |
| 霧港小報 | The Mistport Gazette |
| 號外 | Special edition |

## The eight residents (names keep their Taiwanese flavor)
| id | 中文 | English name | Role line |
|---|---|---|---|
| baker | 阿德 | Barney | the baker |
| florist | 美玲 | Daisy | the florist |
| journalist | 小雯 | Penny | the reporter (runs the town's news blog) |
| mayor | 林市長 | Mayor Higgins | the mayor |
| organizer | 志明 | Gus | the festival organizer |
| police | 老周 | Chief Harlow | the police chief |
| cafe | 美咲 | Molly | the café owner |
| vendor | 阿珠 | Rosa | the takoyaki stall owner (speaks for the stall owners) |

## Game terms
| 中文 | English |
|---|---|
| 一個念頭 / 悄悄話 | a thought / a whisper |
| 植入這個念頭 | Plant the thought |
| 一位陌生客人 | a stranger |
| 補一句 | One more line |
| 讓它淡去 | Let it fade |
| 今晚的小目標 | Tonight's goals |
| 隱藏目標 ??? | hidden goals ??? |
| 鎮民筆記 / 你對X的了解 | Town notebook / What you know about X |
| 想要 / 怕 / 偏誤 / 傳話習慣 / 底線 / 價碼 | wants / fears / bias / gossip habit / line they won't cross / price |
| 耳根軟（很難說服 / 半信半疑 / 容易相信） | Gullibility (hard to convince / half-believes / easy to convince) |
| 能： / 能打給： | Can: / Can call: |
| 錄製的實驗 | Recorded runs |
| 你的實驗 | Your runs |
| 自動導演 / 自由鏡頭 | Auto camera / Free camera |
| 回到小鎮 | Back to town |
| 日常 | Everyday life |
| 同一時間 | Meanwhile |
| 燈籠節不妙 | Festival in trouble |
| 照常 / 縮水 / 延後 / 取消 | on / scaled down / postponed / cancelled |
| 相信 / 半信半疑 / 不相信 | believes / not sure / doesn't believe |
| 親眼查證 / 仔細檢查 / 到處看看 | checked with their own eyes / inspected / looked around |
| 差一點 | So close |
| 試試看 | Try |
| 真相揭曉 | The truth |
| 完整事件因果鏈 | Full chain of events |
| 技術紀錄 / 幕後 | Behind the scenes |
| 再玩一次 | Play again |
| 第一幕 · 傳出去了 / 第二幕 · 全鎮都會知道 / 第三幕 · 事情鬧大了 | Act I · It's out / Act II · The whole town will know / Act III · Things get serious |

## Rules for translators
- Translate every player-visible string and every string sent to the model (prompts, cards, rules, facts, topics,
  public info, routine meeting lines, vignette lines). Code comments may stay as they are.
- Keep ids, enum values, JSON field names and test names' meaning unchanged.
- Where code *parses or matches* text that comes from old logs (`lab/runs/*` are in Chinese), keep matching the old
  Chinese form too (add the English form alongside), so the historical tests still read those logs.
- The model must answer in English: prompts say so explicitly; output length limits stay the same in characters
  (English needs roughly 1.7× the characters of Chinese for the same content — raise 80-character limits on player
  input to 140, and similar caps proportionally).
