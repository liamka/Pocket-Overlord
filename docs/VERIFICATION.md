# Проверка первой версии

## Village roof colors — October 24, 2026

Version 0.6.4 makes house roofs use the same existing village color as map names. Unassigned houses retain their original variant colors. The save schema is unchanged. Concurrent work subsequently renamed the project and advanced it to 0.6.5; that change is outside this roof fix.

The production build passed. Chrome 155 and Firefox 157 each checked 38 roof pixels: six villages with all three house variants plus one unassigned house, before and after reload. Roof pixels matched the existing map-name palette. The ordinary production app served `index-XSM2Meg5.js`; the test seeded IndexedDB and observed native canvas text calls without replacing application JavaScript. No JavaScript errors occurred. All 210 unit tests passed on the assembled 0.6.5 workspace.

Five-minute before/after runs used separately compiled copies with measurement hooks, identical initial seed/RNG state 4831, Apple M2 Pro, 16 GiB, macOS 13.4.1, headless Chrome 155 and Firefox 157, 1440×960, DPR 1. Each browser pair ran concurrently. The scene used 256×192 tiles, 300 residents, up to 6000 entities, requested speed 4×, settlement life, farming, roads, caravans, wars, replenished fires, ten explosive placements every two real seconds, chain blasts and ordinary five-second autosave. Resident age/health and tree counts were maintained. Farm, caravan and war counts changed naturally during the runs. Unit and visual checks also overlapped the baseline, and the final build includes the concurrent rename; the figures do not isolate the cost of roof recoloring.

| Measurement | Chrome before | Chrome after | Firefox before | Firefox after |
| --- | --- | --- | --- | --- |
| Duration, s | 300.05 | 300.09 | 300.06 | 300.05 |
| FPS | 31.68 | 34.40 | 17.08 | 21.83 |
| Frame mean / p95 / p99, ms | 31.56 / 62.20 / 106.70 | 29.07 / 56.30 / 95.00 | 58.54 / 120.00 / 276.00 | 45.81 / 80.00 / 172.00 |
| Simulation step mean / p95 / p99, ms | 6.59 / 25.70 / 55.20 | 5.86 / 22.90 / 50.40 | 12.73 / 41.00 / 134.00 | 8.41 / 28.00 / 65.00 |
| Rendering mean / p95 / p99, ms | 14.99 / 20.40 / 23.60 | 13.98 / 19.40 / 22.10 | 40.07 / 63.00 / 100.00 | 31.45 / 45.00 / 64.00 |
| Synthetic key-to-next-frame mean / p95 / p99, ms | 28.93 / 63.90 / 85.90 | 27.03 / 54.10 / 88.00 | 62.32 / 168.00 / 295.00 | 46.99 / 86.00 / 215.00 |
| Heap first / last / peak, MiB | 12.24 / 39.67 / 82.81 | 12.09 / 57.11 / 85.39 | Unavailable | Unavailable |
| Event queue first / last / peak | 0 / 125726 / 154182 | 0 / 139078 / 159829 | 0 / 170399 / 184171 | 0 / 174645 / 187648 |
| Simulation steps per real second | 57.78 | 65.18 | 18.86 | 30.42 |

All four runs retained 300 residents, reached 6000 entities and reported no JavaScript errors. Both browsers remained below 60 FPS before and after; simulation throughput at requested 4× remained below 120 steps/second, and large event backlogs persisted. These pre-existing maximum-load failures remain unresolved. Input measurements exclude OS and automation latency. Firefox did not expose heap measurements.

Safari was unavailable: its WebDriver rejected session creation because “Allow Remote Automation” is disabled. Playwright WebKit also lacked `webkit-2370/pw_run.sh`. Browser settings were not changed.

## Dynamite and rocket action animations — October 24, 2026

The animation version is 0.6.0; the final assembled workspace is 0.6.2, including concurrent UI changes. Dynamite gains fuse sparks and a final pulse; rockets accelerate toward a pulsing target with exhaust and smoke. Blasts have a bright core, expanding pixel ring, embers, lingering smoke and restrained camera shake. Water uses a separate spray palette. Decorative effects freeze on pause, clear on world replacement and do not alter saved gameplay. Limits are 400 debris particles, 12 simultaneous blast cores/rings, 24 rocket trails and 64 fuse emitters per frame. Ring frames are cached; shake is disabled when reduced motion is requested.

The build and all 213 unit tests passed. All six new browser checks passed in Chrome 155 and Firefox 157: flight/fuse movement, pause/resume, unchanged snapshots, land/water colors, distinct blast phases, visibility at 5000×, expiry, world replacement and bounded drawing work for 2000 simultaneous blasts. These renderer tests use an isolated test page. An additional existing browser subset passed four checks and failed two in Firefox: the sea-population scenario timed out and benchmark artifact cleanup reported ENOENT. Other jobs were changing the workspace and sharing the default test-output directory during that run; its failures were not diagnosed as animation regressions, and it is not a fully green end-to-end suite.

The ordinary production page at `http://localhost:4186/` served `index-L4lA2QG3.js`, including the final animation limits. Chrome and Firefox exercised the real toolbar and keyboard controls with a prepared seed-4831 IndexedDB save. Application JavaScript was unchanged. Exact canvas pixels stayed identical on pause; both explosives disappeared, 60 crater tiles were saved, and reload retained pause. No JavaScript errors occurred. An initial fixed-real-time probe was replaced with explicit polling of saved simulation progress because concurrent machine load slowed simulation.

Safari was not verified: its WebDriver rejected the session because “Allow Remote Automation” is disabled. Playwright WebKit also lacks `webkit-2370/pw_run.sh`. Browser settings were not changed.

Five-minute load runs used separately compiled copies with measurement hooks, Apple M2 Pro, 16 GiB, macOS 13.4.1, headless Chrome 155, 1440×960, DPR 1. The world used 256×192 tiles, 300 residents, approximately 5990–6000 entities and requested speed 4×. The scene exercised settlement life, farming, roads, caravans, wars, replenished fires, ten explosive placements every two real seconds, chain blasts and ordinary five-second autosave. Resident health/age and tree counts were maintained to sustain the load. Other workloads ran concurrently, including browser checks; initial RNG state and subsequent society/fire activity differed between runs. The comparison therefore does not isolate the cost of the animation changes.

| Measurement | Before, 300.06 s | Final bounded effects, 300.08 s |
| --- | --- | --- |
| FPS | 35.00 | 29.36 |
| Frame mean / p95 / p99, ms | 28.57 / 53.00 / 80.90 | 34.06 / 68.20 / 114.00 |
| Simulation step mean / p95 / p99, ms | 5.66 / 21.90 / 43.90 | 7.27 / 28.90 / 61.20 |
| Rendering mean / p95 / p99, ms | 13.67 / 18.30 / 20.60 | 16.34 / 22.10 / 26.30 |
| Synthetic canvas key-to-next-frame mean / p95 / p99, ms | 26.19 / 52.10 / 66.20 | 29.13 / 52.20 / 81.80 |
| Heap first / last / peak, MiB | 13.75 / 30.67 / 75.92 | 13.83 / 29.72 / 79.43 |
| Event queue first / last / peak | 0 / 132583 / 153046 | 0 / 145061 / 164417 |
| Simulation steps per real second | 65.91 | 51.26 |

Both runs retained 300 residents, reached 6000 entities and had no JavaScript errors. Input timings exclude OS and automation latency. Neither run meets 60 FPS or the requested 120 simulation steps/second; event queues grow substantially. The final run is slower than the baseline under these conditions. Maximum-load performance remains unverified as acceptable; these results are not a claim of no slowdown or a causal measurement of animation overhead. The pre-existing simulation/event backlog is outside this animation change.

A final paired renderer-only check alternated the old and final renderers on identical snapshots (seed 4831, 6000 entities, 300 residents, 57 rockets, repeated visual blasts; 60 warm-up frames and 180 measured frames). Chrome rendering mean/p95/p99 was 28.67/73.80/77.90 ms before and 28.86/73.90/76.90 ms after; Firefox was 25.81/29/33 ms before and 27.49/30/32 ms after. These are drawing CPU timings in a synthetic scene, not FPS or a simulation benchmark. The final decorative budgets reduced the added drawing work; Firefox still shows additional mean rendering cost.

## Localized settlement names — October 24, 2026

Version 0.3.4 passes the build and all 195 unit tests. Twenty focused browser checks pass across Chrome and Firefox. Coverage includes names from both Russian and English saves, all five languages, actual Canvas text calls, village lists, diplomatic sides and chronicles, switching back to English, custom names, reload, hidden statistics and the existing performance scene. Unit tests also cover deterministic generation, 300 distinct names per language, collision retries and numbered fallbacks, unchanged simulation RNG, legacy eight-name aliases and cache invalidation. Safari remains unverified: Playwright cannot launch the missing `webkit-2370/pw_run.sh` executable.

The ordinary app at `http://localhost:4173/` served `index-Dg6DoziT.js` and version 0.3.4. A prepared Russian saved world displayed `New Dawn`, `Distant Cliff`, `New Eden` and `Delzen` in English; English and Japanese map labels were visually inspected, and all five settings were exercised. Reload retained English and the stored world exactly matched the original snapshot. The production page used unchanged application JavaScript; the prepared save was the only fixture. No JavaScript errors occurred on that page. Save format remains v11.

Two five-minute runs used the separately compiled, instrumented app on Apple M2 Pro, 16 GB, macOS 13.4.1, Chrome 155, 1440×960: 256×192 tiles, 300 residents, approximately 5990–6000 entities, speed 4×, villages, crops, roads, caravans, war, replenished burning trees, ten explosives every two real seconds and ordinary autosave. Resident health/age and tree counts were maintained. Other verification ran concurrently; starting seeds and the fire schedule differ, so the comparison does not isolate the cost of naming.

| Measurement | Before, 300.18 s | After, 300.19 s |
| --- | --- | --- |
| FPS | 35.05 | 34.08 |
| Frame mean / p95 / p99, ms | 28.53 / 66.6 / 100 | 29.34 / 66.6 / 116.7 |
| Simulation mean / p95 / p99, ms | 6.01 / 24.3 / 58.8 | 6.46 / 21 / 68.9 |
| Rendering mean / p95 / p99, ms | 12.50 / 16.5 / 18.4 | 12.28 / 15.2 / 18.7 |
| Heap first / last / peak, MiB | 45.97 / 59.69 / 100.14 | 18.88 / 63.23 / 145.28 |
| Event queue first / last / peak | 220894 / 316211 / 394374 | 190902 / 330277 / 394660 |
| Simulation steps per real second | 65.37 | 62.75 |

Both runs retained 300 residents. The harness's synthetic key probe dispatched events on `Document`, causing 150 `target.matches` errors in each run; its input measurements are excluded. A separate eight-key Playwright check targeted the actual canvas during the after-run and measured 12.6–14.4 ms from keydown capture to the next animation frame, excluding automation/focus overhead. This is not an OS-to-display latency measurement. The existing maximum-load problem remains: neither run sustains 60 FPS or the requested 120 simulation steps per second, and the fire queue exceeds the save decoder's 200000-event limit. This naming change does not fix that separate issue.

The existing 300-resident benchmark measured simulation mean/p95 of 2.03/3.7 ms in Chrome and 2.95/5 ms in Firefox; rendering mean/p95 was 2.25/2.9 ms and 4.91/7 ms respectively. These are CPU timings in a different scene, not FPS.

## Sparse heart notifications — October 24, 2026

Version 0.3.2 passes the build and all 188 unit tests. Six focused browser checks pass across Chrome and Firefox: one brief notification per couple, pause and expiry, no permanent pregnancy badges after reload, unchanged weapon badges, and overlapping-crowd suppression. Two existing browser performance checks also pass.

The ordinary production app at `http://localhost:4173/` served `index-Bw8CRHix.js`. A prepared saved scene with eight residents formed four couples and displayed one spaced heart (232 pink pixels at 2× zoom); resuming removed it after its short lifetime. No application JavaScript was replaced, and no JavaScript errors occurred. Saved gameplay and save format v11 are unchanged.

A separate instrumented renderer comparison used 300 residents with reciprocal partner links. Before: 128 hearts from a full visual-event batch, still 128 after two simulation seconds, and 150 permanent hearts for stalled pregnancies after transient notifications expired. After: six hearts, then zero after two seconds, and zero for stalled pregnancies. These are observed draw calls in a test scene, not FPS measurements.

The existing 300-resident performance scene measured simulation mean/p95 of 1.91/3.4 ms in Chrome and 2.48/4 ms in Firefox; rendering mean/p95 was 2.15/2.9 ms and 4.15/5 ms respectively. Safari remains unverified: Playwright WebKit cannot launch because `webkit-2370/pw_run.sh` is absent.

Five-minute before/after load runs used the instrumented compiled app, Apple M2 Pro, 16 GB, macOS 13.4.1, Chrome 155, 1440×960, 256×192 tiles, 300 residents, approximately 5990–6000 entities and requested speed 4×. The scene sustained villages, farming, caravans, war, replenished fires, ten explosives every two real seconds and ordinary autosave. Resident age/health and tree counts were maintained. Other checks ran concurrently; throughput changes also change the fire schedule, so these measurements do not establish a causal speedup.

| Measurement | Before, 300.13 s | After, 300.15 s |
| --- | --- | --- |
| FPS | 36.11 | 37.55 |
| Frame mean / p95 / p99, ms | 27.70 / 66.6 / 116.7 | 26.63 / 50 / 99.9 |
| Simulation step mean / p95 / p99, ms | 6.19 / 27 / 63 | 5.54 / 20.7 / 48.8 |
| Rendering mean / p95 / p99, ms | 11.96 / 15.7 / 17.1 | 12.01 / 15.7 / 17.1 |
| Synthetic key-to-next-frame p95 / p99, ms | 19.7 / 22.8 | 19.7 / 22.9 |
| Heap first / last / peak, MiB | 43.6 / 61.2 / 135.0 | 47.8 / 60.4 / 120.3 |
| Event queue first / last / peak | 220314 / 322722 / 397251 | 220348 / 325077 / 394994 |
| Simulation steps per real second | 65.33 | 68.04 |

Both runs retained 300 residents and 5990 entities with no JavaScript errors. Rendering p95/p99 and input p95 were unchanged. The pre-existing maximum-load failure remains: neither run sustains 60 FPS or 120 simulation steps/second, and fire queues exceed the save decoder's 200000-event limit. This notification fix does not address that separate overload problem.

## Migration, founding, seasons and reserves — October 24, 2026

Version 0.3.0, save format v11. The build and all 186 unit tests pass. New coverage includes whole-family travel and reserved housing, famine/war/homelessness triggers, inaccessible and hostile destinations, supplied pioneering, fertile colony sites, destination destruction, traveler deaths and swimming, deterministic continuation, pause, v10 saves, seasonal yields, winter consumption, caravan reserves and all five UI languages.

Sixteen browser checks passed across Chrome and Firefox: the three new scenarios plus farming, caravans, coalition war, retained hidden village statistics and the existing performance scene. The first run passed 12 and exposed two test issues in both browsers: the old war test tried to scroll an intentionally hidden panel, and the winter test accepted the initial paused save before the next autosave. After correcting those assertions, all four affected checks passed on rerun. No game behavior was changed to satisfy these assertions.

The production build at `http://localhost:4173/` was checked separately with prepared saved worlds and unchanged application JavaScript (`index-Cy2l78ky.js`). Four pioneers arrived and established a second village; reload retained the result. Crossing into winter reduced food from 100 to 97, with winter and the paused tick retained on reload. A v10 world was upgraded to v11 without changing entities, terrain or food. The seasonal HUD fits at 900×650 in English, Russian, Simplified Chinese, Japanese and Spanish. No JavaScript errors occurred in these checks.

Five-minute before/after measurements used an instrumented compiled application, Apple M2 Pro, 16 GB, macOS 13.4.1, Chrome 155, 1440×960. The scene used 256×192 tiles, 300 residents, approximately 5990–6000 entities, four villages, fields, roads, caravans, war, extensive fire, ten explosives every two real seconds, autosave and requested speed 4×. Trees were replenished and resident age/health maintained to sustain load. Other checks ran on the machine concurrently, and fire scheduling depends on actual simulation throughput; these runs are not an isolated measurement of the cost of the new systems.

| Measurement | Before, 300.14 s | After, 300.27 s |
| --- | --- | --- |
| FPS | 31.29 | 34.98 |
| Frame mean / p95 / p99, ms | 31.96 / 66.7 / 150 | 28.58 / 66.6 / 100 |
| Simulation step mean / p95 / p99, ms | 7.18 / 31.3 / 74.8 | 6.20 / 27.5 / 58.3 |
| Rendering mean / p95 / p99, ms | 13.57 / 18.3 / 22.7 | 12.43 / 16.4 / 18.9 |
| Synthetic key-to-next-frame p95 / p99, ms | 23.4 / 27.8 | 19.6 / 23.7 |
| Heap first / last / peak, MiB | 17.3 / 60.1 / 114.4 | 46.5 / 68.2 / 106.5 |
| Event queue first / last / peak | 164285 / 323812 / 394193 | 220353 / 323554 / 395746 |
| Simulation steps per real second | 55.71 | 63.06 |

Both runs ended with 300 residents and 5990 entities and reported no JavaScript errors. The existing maximum-load limitation remains: 60 FPS and the requested 120 steps/second at 4× are not sustained, and the queue exceeds the save decoder's 200000-event limit. This work does not fix that pre-existing overload behavior or establish a maximum-load performance guarantee.

The existing 300-resident browser benchmark measured simulation mean/p95 of 1.91/3.2 ms in Chrome and 2.46/4 ms in Firefox; rendering mean/p95 was 2.14/3 ms and 3.91/5 ms respectively. Those are CPU timings, not FPS. Safari was not verified: Playwright WebKit could not launch because `webkit-2370/pw_run.sh` is absent; an older cached WebKit is not a substitute for current Safari.

## Пакеты контента и сценарии — 24 октября 2026

Сборка и 168 unit-тестов прошли. Новый тестовый пакет добавляет собственный компонент, тип сущности, инструмент с рисунком, воздействие, систему и сценарий без изменения общих обработчиков. Проверены 400 дополнительных типов, взаимодействия с огнём/дождём/взрывом, ограничение очереди, порядок систем, ошибки дублирования и зависимостей, пауза сценария, продолжение RNG после загрузки, завершение сценария, неизвестные пакеты и повреждённое состояние. Миграция v9 → v10 сохраняет существующий мир и добавляет список пакетов и сценариев.

Полный браузерный прогон прошёл: 54 проверки, по 27 в Chrome и Firefox, 9,2 минуты. Охват: прежние инструменты и управление, все скорости, семьи и плашки, земледелие, караваны, войны, ремонт дорог, восстановление земли, автосохранение, четыре перевода и расширение из отдельного пакета.

Стандартная сцена с 300 жителями и взрывами: Chrome — шаг симуляции 1,886 мс в среднем / 3,3 мс p95, отрисовка 2,118 / 2,7 мс; Firefox — шаг 2,53 / 4 мс, отрисовка 4,18 / 5 мс. Это время вычислений и рисования, а не измерение FPS.

Интеграционная проверка расширения прошла в Chrome и Firefox: отдельная страница собирает реальные `UI`, `Renderer`, `World` и `SaveService` с `tests/fixtures/content-pack.ts`. Проверяются категория инструмента, пиксели собственного значка и объекта, запись в IndexedDB, повторное открытие страницы и продолжение сценария. Эта страница является тестовым стендом; новый контент не подключён к обычной игре.

Сравнены снимки старого и нового движка после 900 фиксированных шагов при одинаковом seed: 40 жителей, деревья, динамит, ракета и дождь. Данные мира и RNG совпали полностью; исключены только новые поля формата и номер версии. На обычном сервере `http://localhost:4173/` дополнительно загружен подготовленный снимок v9 на паузе: 40 жителей, четыре инструмента, точная миграция и повторная загрузка без изменения состояния. JavaScript приложения не подменялся; `index-DqUGYPff.js`, отдаваемый сервером, совпал с `dist`. Ошибок JavaScript нет.

Нагрузочные прогоны до/после: Apple M2 Pro, 16 ГБ, macOS 13.4.1, Chrome 155, 1440×960, по пять минут. Использована отдельно собранная инструментированная копия приложения и одинаковая сцена: 256×192 клетки, 300 жителей, до 6000 сущностей, четыре поселения, поля, дороги, караваны, война, массовые пожары, десять взрывчатых объектов каждые две реальные секунды, штатное автосохранение, скорость 4×. Возраст/здоровье жителей поддерживались и деревья пополнялись для удержания нагрузки. Во время прогонов также выполнялись другие проверки; эти цифры не изолируют влияние рефакторинга от нагрузки машины.

| Измерение | До, 300,3 с | После, 300,0 с |
| --- | --- | --- |
| FPS | 36,1 | 35,7 |
| Кадр, среднее / p95 / p99, мс | 27,68 / 33,4 / 50 | 28,03 / 33,4 / 50 |
| Шаг симуляции, среднее / p95 / p99, мс | 4,27 / 15,7 / 19,4 | 4,84 / 16,1 / 19,4 |
| Отрисовка, среднее / p95 / p99, мс | 11,08 / 12,6 / 17,2 | 11,14 / 13,1 / 18,6 |
| Синтетическая проба управления, p95 / p99, мс | 72,3 / 91,5 | 74,4 / 85,9 |
| Куча, начало / конец / максимум, МБ | 48,1 / 155,9 / 239,0 | 31,1 / 237,2 / 256,4 |
| Очередь, начало / конец / максимум | 146 033 / 1 263 502 / 1 298 432 | 120 248 / 1 253 333 / 1 339 454 |
| Шагов симуляции в секунду | 64,1 | 63,2 |

60 FPS и устойчивость очереди на предельной сцене не достигнуты ни до, ни после. Массовый огонь производит события быстрее бюджета обработки; очередь превышает предел декодера в 200000 событий. Это существующее ограничение, его исправление в данный рефакторинг не входит. Цифры не подтверждают ускорение или отсутствие тормозов на максимуме. Ошибок JavaScript в обоих прогонах нет.

Safari для этого изменения не проверен: исполняемый файл Playwright WebKit отсутствует; автоматизация установленного Safari ранее была недоступна из-за выключенного Allow Remote Automation.

## Плашки над жителями — 24 октября 2026

Сборка и 158 unit-тестов прошли. Сердечки появляются у обоих участников новой пары на пять игровых секунд, останавливаются на паузе и удаляются после окончания эффекта, смерти партнёра или смены мира. Беременность восстанавливает сердце из сохранения. Скрещённые мечи показываются у бойцов действующей войны, включая союзников, во время сбора и похода; перемирие убирает их. Дети и мирные жители не получают значок оружия, отдельного значка огня нет. Правила горения и бегства не изменялись.

В Chrome и Firefox прошли по пять сценариев: создание пары и истечение сердечек, сохранённые плашки оружия/беременности и отсутствие плашки огня, общая война союзов, четыре инструмента и нагрузочная сцена на 300 жителей. После финального смещения плашек на два игровых пикселя вверх, чтобы открыть полоски здоровья, оба сценария плашек повторно прошли в обоих браузерах. Проверки читают пиксели настоящего Canvas; подготовленные миры задаются через IndexedDB, JavaScript приложения не подменяется. Safari не проверен: Playwright WebKit не установлен, автоматизация установленного Safari ранее была недоступна.

На `http://localhost:4173/` отдельно осмотрена подготовленная сцена с четырьмя поселениями, сердцем, бойцами и горящим мирным жителем. Использовалась обычная собранная игра, без подмены её JavaScript. Снимок на паузе не изменился и восстановился после перезагрузки; ошибок JavaScript нет. Отдаваемый сервером `index-C3pC_8rj.js` совпал с файлом в `dist`. Визуально проверены светлая пиксельная плашка, хвостик, сердце, мечи и зазор над полоской здоровья.

Пятиминутные прогоны до/после добавления плашек выполнены на Apple M2 Pro, 16 ГБ, macOS 13.4.1, Chrome 155, 1440×960, скорость 4×. Отдельно собранная инструментированная сцена: карта 256×192, 300 жителей, до 6000 сущностей, поселения, поля, дороги, караваны, война, непрерывно пополняемые пожары и взрывы, автосохранение. Для удержания нагрузки поддерживались здоровье и возраст жителей и добавлялись сгоревшие деревья. Одновременно выполнялись функциональные проверки; это не изолированный аппаратный тест. Замер плашек завершён на варианте до финального смещения вверх; алгоритм и число операций рисования после смещения не менялись. В сцене зафиксированы пики 128 сердечек и 90 значков оружия.

До, 300,0 с: 34,6 FPS; кадр средний/p95/p99 — 28,79/49,9/66,6 мс; шаг симуляции — 5,07/21,1/26,6 мс; отрисовка — 11,4/15,7/20,6 мс; синтетическая проба управления p95/p99 — 931,4/1054,7 мс. Куча: 52 → 147,3 МБ, максимум 261,7 МБ. Очередь событий: максимум 1 338 066, в конце 1 268 300.

После, 300,3 с: 35,0 FPS; кадр — 28,6/33,4/50 мс; шаг — 4,89/16,3/20,6 мс; отрисовка — 11,4/13,4/18,7 мс; проба управления p95/p99 — 81,4/119,6 мс. Куча: 57,1 → 183,2 МБ, максимум 288,8 МБ. Очередь: максимум 1 373 126, в конце 1 340 332. Среднее время отрисовки в этих двух прогонах одинаковое; улучшение задержек управления нельзя приписать плашкам. Ошибок JavaScript нет. Прежняя перегрузка очереди массового огня сохраняется: 60 FPS на предельной сцене не достигнуты, её очередь превышает предел декодера сохранений. В этой задаче проблема не исправлялась.

## Меню времени по образцу — 24 октября 2026

Сборка и 154 unit-теста прошли. Проверены все девять скоростей ⅕×–5000×, фиксированный шаг, ограничение расчёта по времени кадра, отсутствие накопленного отставания, таймеры взрывов, сохранение выбранной скорости и паузы, миграция v8 → v9. Бюджет часов проверяется управляемым измерителем стоимости шага, без зависимости от загрузки тестовой машины.

Прошли 28 браузерных проверок: по 14 в Chrome и Firefox. Охват: меню, все скорости, стрелки и их крайние положения, клавиатура и цифровой блок, Escape/Tab/щелчок снаружи, пауза, размещение взрывчатки, автосохранение и перезагрузка, четыре инструмента, ремонт дороги, четыре перевода, компактный интерфейс. Меню проверено при 1440×960, 900×650 и 700×500. Первый прогон выявил незакрывающееся по Tab меню; после исправления повтор прошёл. Safari не проверен: исполняемый файл Playwright WebKit отсутствует; автоматизация установленного Safari ранее была недоступна из-за выключенного Allow Remote Automation.

Отдельно осмотрена собранная игра на `http://localhost:4173/`: коричневое меню с золотистой рамкой и подписи соответствуют образцу. Отдаваемый `index-BIx9ccEf.js` точно совпал с файлом в `dist`. Новое меню проверено на всех пяти языках через штатные настройки. JavaScript, карта и сохранение для этой проверки не подменялись.

В той же рабочей сборке на случайном острове seed 83591969 обычными щелчками размещены 300 жителей. Затем выбран режим 5000× на 60 секунд. Получено 59,95 FPS; время кадра p95/p99 — 16,8/16,8 мс, максимум — 33,4 мс. От события pointerdown на кнопке меню до следующего кадра — 14,2 мс (это не задержка физической мыши). Пик измеренной кучи — 61,6 МБ. Мир прошёл 12 680 шагов, то есть фактическое ускорение около 7,04×, ограниченное бюджетом расчёта. К концу естественной симуляции осталось 200 жителей и построено 149 домов; постоянные 300 жителей в этом прогоне не поддерживались. Очередь событий в сохранении пуста, ошибок JavaScript нет. Пауза с выбранной 5000× и полный снимок мира восстановились после перезагрузки без изменений.

Пятиминутное сравнение максимальной нагрузки до/после выполнено на Apple M2 Pro, 16 ГБ, macOS 13.4.1, Chrome 155, 1440×960. Использована отдельно собранная инструментированная копия приложения: карта 256×192, 300 жителей, до 6000 сущностей, четыре поселения, поля, дороги, караваны, война, постоянно возобновляемые пожары и взрывы, штатное автосохранение, скорость 4×. Здоровье/возраст жителей поддерживались, деревья добавлялись заново для сохранения нагрузки. Во время обоих прогонов также выполнялись функциональные проверки, поэтому сравнение не является изолированным аппаратным тестом.

До изменения, 300,1 с: 25,3 FPS; кадр средний/p95/p99 — 39,46/50/100 мс; один шаг симуляции — 4,6/15,8/20,7 мс; отрисовка — 11,61/16,4/20,4 мс; синтетическая проба управления p95/p99 — 116,4/144,9 мс. Выполнялось 94,9 шага/с. Куча: 26,9 → 202,2 МБ, максимум 270,7 МБ; очередь: максимум 1 264 143, в конце 1 109 155 событий.

После изменения, 300,6 с: 32,3 FPS; кадр — 30,96/49,9/66,7 мс; один шаг — 5,29/17/26,8 мс; отрисовка — 12,38/18/25,4 мс; проба управления p95/p99 — 95,2/149,8 мс. Выполнялось 55,8 шага/с: ограничение работы за кадр сохраняет отзывчивость за счёт фактического ускорения при перегрузке. Куча: 43 → 215,3 МБ, максимум 262,6 МБ; очередь: максимум 1 335 250, в конце 1 275 966 событий. Ошибок JavaScript нет.

**Сохраняющееся ограничение:** 60 FPS при 6000 объектах не достигнуты. Массовый огонь по-прежнему раздувает очередь, а тяжёлый одиночный шаг и автосохранение могут задержать кадр. Ограничение числа шагов не исправляет эту существовавшую до изменения проблему; такая очередь также превышает предел декодера сохранений. Значения 500×/5000× задают желаемое ускорение, а не гарантируют его на любой сцене.

## Разрушение и ремонт дорог — 24 октября 2026

Прошли 134 unit-теста и сборка. Проверены разрушение дороги в центре и на краю взрывов динамита и ракеты, сохранение воды и клеток вне радиуса, подход взрослого рабочего и три секунды работы на месте, отсутствие ремонта детьми или без жителей, недоступные участки, смерть и замена рабочего, повторный удар, пауза, продолжение сохранённого ремонта и миграция v7 → v8. Повреждённая дорога исключается из готовых маршрутов; отправка новых караванов возобновляется после ремонта.

В Chrome и Firefox прошли четыре браузерных сценария: разрушение и ремонт дороги с перезагрузкой, поездка каравана, размещение в море и основной сценарий четырёх инструментов. Они используют подготовленные снимки мира без подмены JavaScript приложения. Один прогон основного сценария Firefox завершился ошибкой записи артефактов из-за одновременного запуска другого набора; отдельный повтор прошёл. Safari 16.5.2 недоступен для автоматизации: системный драйвер отказал из-за выключенного Allow Remote Automation. Исполняемый файл Playwright WebKit также отсутствует.

Отдельно проверена собранная игра на `http://localhost:4173/`, `index-EIkOp1cL.js`, на новом случайном острове seed 1019073040. Без подмены карты, сохранения или кода обычными кликами созданы две группы по 12 жителей. Они построили дорогу из 70 клеток. Динамит в точке (81,5; 56,5) разрушил 11 дорожных клеток. На шаге 2997 сохранены четыре рабочих с маршрутами и прогрессом, затем игра перезагружена. К шагу 5340 восстановлена вся дорога. Разрыв, работа жителей и результат осмотрены в браузере; ошибок JavaScript не было. Файл, отдаваемый preview-сервером, совпал с локальной сборкой.

В обычной нагрузочной сцене с 300 жителями и взрывами: Chrome — симуляция 1,863 мс в среднем / 3 мс p95, отрисовка 2,155 / 3 мс; Firefox — симуляция 2,507 / 4 мс, отрисовка 3,88 / 5 мс. Эти короткие измерения не подтверждают производительность на пределе в 6000 объектов.

Предельная сцена измерена до и после изменения на Apple M2 Pro, 16 ГБ RAM, macOS 13.4.1, Headless Chrome 155, окне 1440 × 960. Для неё отдельно собраны игровые модули с измерительными обёртками: карта 256 × 192, 300 жителей, около 6000 объектов, четыре поселения, поля, дороги, караваны, война, постоянно пополняемые пожары и серии из десяти взрывчатых объектов, скорость 4× и штатное автосохранение. Это искусственная стресс-сцена: здоровье и возраст жителей поддерживались, а сгоревшие деревья добавлялись заново, чтобы нагрузка не исчезала. Проверка настоящего острова выше выполнена отдельно без этих подмен.

До изменения, за 300,1 с: симуляция 4,46 мс в среднем / 14,8 мс p95 / 18 мс p99, очередь до 1 227 929 событий. FPS и отклик исходного прогона не используются для сравнения: измеритель продолжал считать кадры после остановки нагрузки и неправильно отправлял синтетические клавиши. Исправленный повтор после изменения, также 300,1 с, прошёл без ошибок JavaScript: 26,8 FPS; кадр 37,29 мс в среднем / 50 мс p95 / 99,9 мс p99; симуляция 4,54 / 15,5 / 19,8 мс; отрисовка 11,33 / 16,1 / 20,3 мс. Синтетическая проба от постановки команды управления до следующего кадра — 151 мс p95 / 1072,4 мс p99; это не измерение задержки физической мыши. Выполнялось 96,2 игровых шага/с вместо целевых 120 на 4×. Куча JavaScript: 65,1 МБ в начале, 223,4 МБ в конце, максимум 259,9 МБ; очередь — максимум 1 229 225, в конце 1 172 397 событий.

**Ограничение:** предельный тест не проходит требование плавности из AGENTS.md. Разрастание очереди воздействий массового огня присутствует и в исходной версии; в этой задаче оно не исправлено. 60 FPS на 6000 объектах не подтверждены. Кроме того, очередь в стресс-сцене превышает допустимый размер очереди в декодере сохранений; такое автосохранение не восстановится как обычный мир. Рабочий ремонт дорог и восстановление его состояния проверены отдельно при обычной нагрузке.

## Восстановление ландшафта — 24 октября 2026

Прошли 93 unit-теста и сборка. Новые проверки охватывают постепенное восстановление после динамита и ракеты, остановку восстановления под огнём, повторный удар, возвращение песка без изменения воды, сохранение прогресса, работу паузы и скоростей 1× / 2× / 4×, миграцию v5 → v6 и отклонение повреждённых записей восстановления. Погибшие сущности не воссоздаются.

В Chrome и Firefox прошли сценарий постепенного восстановления с паузой и перезагрузкой, основной сценарий четырёх инструментов и нагрузочная сцена. Браузерный сценарий восстановления использует подготовленный мир с последствиями двух взрывов; JavaScript приложения не подменяется. Он проверяет частичное зарастание, неизменность почвы на паузе после автосохранения, продолжение после загрузки и полное восстановление на 4×. Один запуск основного сценария Firefox прервала перезагрузка dev-сервера во время изменения справки; повтор без редактирования файлов прошёл.

Отдельно проверена собранная игра на `http://localhost:4173/`, `index-B6FochvF.js`: новый случайный остров, seed 2911315616, без подмены карты, сохранения или кода. Ракета направлена в песчаный берег (110,5; 22,5), динамит — в траву (108,5; 82,5). Повреждённых клеток: 148 после взрывов, 46 на промежуточном этапе, 0 к шагу 3136. Промежуточный снимок восстановился после перезагрузки без изменения прогресса. В конце массив поверхности точно совпал с исходным; вода не изменилась. Ошибок JavaScript не было. Промежуточный и итоговый ландшафт осмотрены в браузере; отдаваемый сервером JavaScript совпал с локальной сборкой.

Нагрузочная сцена с 300 жителями, огнём и взрывами: Chrome — симуляция 1,828 мс в среднем / 3 мс p95, отрисовка 2,082 / 2,8 мс; Firefox при отдельном повторе — симуляция 2,707 / 4 мс, отрисовка 4,273 / 6 мс. Это измерения на текущей машине, без обещания FPS на других устройствах. Safari для этого изменения не проверялся.

## Скорость времени и размещение на паузе — 24 октября 2026

Прошли 81 unit-тест и сборка. Проверены фиксированный шаг при 1×, 2× и 4×, отсутствие догоняющего расчёта после паузы и скрытия вкладки, размещение нескольких бомб в остановленном мире, таймеры взрывов при каждой скорости, возобновление предыдущей скорости, сохранение скорости и миграция v4 → v5.

В Chrome и Firefox прошли по три сценария скорости: «Стоп», размещение двух шашек динамита и двух ракет, неизменные таймеры на паузе, запуск на 1× / 2× / 4×, взрывы, автосохранение, перезагрузка, возобновление пробелом и возврат к обычной скорости. Размещение четырёх кнопок проверено при 1440 × 960 и 900 × 650; обнаруженное обрезание снизу в узком окне исправлено. Дополнительно в обоих браузерах прошли основной сценарий четырёх инструментов и проверка интерфейса со справкой. Эти тесты загружают подготовленный мир в IndexedDB, не подменяя JavaScript игры.

Отдельная проверка собранной игры на `http://localhost:4173/`: новый случайный остров с seed 466630243, без подмены карты, сохранения или кода. Кнопкой «Стоп» остановлено время; обычными щелчками размещены два динамита и две ракеты. После автосохранения таймеры оставались 2 / 2 / 1,25 / 1,25 секунды. При запуске 4× за примерно 0,85 секунды выполнены 103 игровых шага, все четыре объекта взорвались, появилось 132 клетки кратеров. Скорость 4× и пауза восстановились после перезагрузки; пробел возобновил 4×. Содержимое отдаваемого сервером `index-DxVyVx4Z.js` совпало с локальной сборкой. Safari для этого изменения не проверялся.

## Союзы и общие войны — 24 октября 2026

`npm test`: 70 тестов прошли. Проверены союз из трёх деревень, взаимная защита, три независимых союза против четвёртого, автоматическое вступление в общую войну, подкрепления, согласие участников при расширении союза, помощь едой, сбор войск, движение и реальные потери, общее перемирие, исчезновение деревень и детерминированное продолжение. Миграция v3 → v4 сохраняет совместимые старые договоры и войны; противоречивые стороны, цели и неполные отношения отклоняются. Длинные сообщения больших союзов остаются совместимыми с сохранением.

Сборка TypeScript/Vite прошла. Полный набор — 9 браузерных сценариев в Chrome и 9 в Firefox — прошёл. Сценарий коалиции проверяет четыре союза, одну войну шести деревень против двух, переход от сбора к походу, паузу, автосохранение, перезагрузку и панель при 900 × 650. Используется подготовленное сохранение; JavaScript приложения не подменяется.

Отдельно проверена собранная игра на `http://localhost:4173/`, файл `index-D7Ow8pSK.js`: подготовленный мир с тремя союзами против четвёртого дошёл до общего похода, сохранился на шаге 253 и восстановился на паузе с теми же сторонами. Ошибок JavaScript нет. Панель союзов, цель похода и флаги осмотрены в браузере.

Ускоренный прогон действующих систем в Chrome: плоская тестовая карта 96 × 64, восемь деревень, 32 исходных жителя, готовые дороги и нейтральные отношения. За 300 игровых секунд самостоятельно появились два союза (до четырёх деревень в каждом), общие войны, вступление дополнительной деревни, потери и перемирия. К концу — 68 жителей; наибольшее число учтённых потерь за один поход — 28. Снимки каждые 30 секунд прошли проверку. Это управляемая тестовая сцена и ускоренная симуляция, а не наблюдение за случайным островом в реальном времени.

Отдельная нагрузочная сцена в Chrome: после 60 секунд развития — 300 жителей, затем война шести деревень против двух; в конце измерения — 107 домов, 63 поля и 470 сущностей. За 300 шагов: симуляция в среднем 2,127 мс, p95 7,5 мс, максимум 18,8 мс; отрисовка в среднем 1,812 мс, p95 4,7 мс. Для сохранения нагрузки здоровье людей задано 100000, начальная еда — 500 на деревню. Итоговый снимок прошёл проверку.

В стандартной браузерной сцене с 300 жителями, огнём и взрывами: Chrome — симуляция 1,649 мс в среднем / 2,8 мс p95, отрисовка 2,027 / 2,5 мс; Firefox — симуляция 2,053 / 3 мс, отрисовка 3,673 / 5 мс. Это измерения CPU на этой машине, без обещания FPS на других устройствах. Safari для этого изменения не проверялся.

## Выбор почвы для полей — 24 октября 2026

После замены случайного выбора поля поиском доступной травяной почвы прошли 52 unit-теста. Проверены единственный участок 3 × 3, отсутствие плодородной земли, водная преграда, занятая деревом почва, наличие взрослых работников и перенос поля после разрушения почвы. Сборка прошла.

В Chrome и Firefox прошли два сценария на браузер: жизнь поселений с перезагрузкой и выращивание на единственном плодородном участке. В обоих используются подготовленные сохранения, JavaScript игры не подменяется. Отдельно тот же участок проверен в собранной игре на `http://localhost:4173/`: поле появилось в координатах (33,5; 24,5), к 20,93 игровой секунды собрано 8 единиц еды; ошибок JavaScript нет. Мир для этой проверки — одно поселение на песке с единственным квадратом травы 3 × 3.

## Расширение жизни поселений — 24 октября 2026

- `npm test`: 43 теста прошли. Новые проверки охватывают дороги вокруг воды, работу на полях, урожай, расход еды и голод, семьи и родителей, беременность после смерти отца, союзы и помощь едой, урон в войне, перемирие, разрушение полей и сохранение нового состояния.
- `npm run build` прошёл. Полный набор браузерных сценариев: 7 в Chrome и 7 в Firefox, все прошли. Новый сценарий проверяет деревни, семьи, детей, поля, дороги, летопись, перезагрузку и панель при 900 × 650. Эти автоматические сценарии используют тестовые сохранения в IndexedDB; код приложения не подменяется.
- Отдельно проверена сборка на `http://localhost:4173/` с новым случайным островом, без подмены карты, сохранения или JavaScript: 24 жителя размещены кликами. На 38-й игровой секунде — 3 деревни, 25 жителей, 1 ребёнок, 56 единиц собранного урожая и 2 завершённые дороги (41 и 66 клеток). Пауза и перезагрузка прошли, ошибок JavaScript нет. Seed: 1998254729. После этой проверки в сборке изменён только текст справки.
- Отдельный ускоренный прогон действующих систем в Chrome: seed 4831, 24 исходных жителя в трёх местах, 420 игровых секунд. Каждые 30 секунд снимок проходил декодирование. К концу — 135 жителей, 50 детей, 3 деревни, 2 дороги, 1 союз и 2 войны; между войнами происходили перемирия. Это ускоренная проверка симуляции, а не семь минут ожидания в интерфейсе.

Новая нагрузочная сцена в Chrome после 60 секунд развития: 300 жителей, 6 деревень, 107 домов, 21 поле, 5 дорог; за следующие 300 шагов среднее время симуляции — 2,699 мс, p95 — 9,5 мс, максимум — 12,7 мс. Для сохранения нагрузки здоровье жителей задано 100000. Валидность итогового сохранения проверена. Отрисовка в этом замере не измерялась.

В прежней браузерной сцене с огнём и взрывами: Chrome — симуляция 1,738 мс в среднем / 3,2 мс p95, отрисовка 2,045 / 2,6 мс; Firefox — симуляция 2,280 / 4 мс, отрисовка 3,963 / 5 мс. Эти цифры относятся только к данной машине и сценам. Safari для нового расширения не проверялся.

Ниже сохранены результаты исходной версии.

Проверено 24 октября 2026 года на Apple M2 Pro, 16 ГБ памяти, macOS 13.4.1. Локальная среда: Node.js 23.6.1; эта ветка не входит в поддерживаемые версии Vitest, хотя проверки прошли. Для воспроизводимого запуска проекта используйте Node.js 22 LTS или 24+. Зависимости установлены npm 11.6.2; lockfile включён.

## Результаты

- `npm run build`: проверка TypeScript и production-сборка прошли.
- Собранный `dist` отдельно открыт через `vite preview` в Chrome: создание человека, взрыв динамита и появление 16 клеток кратера проверены; ошибок JavaScript нет.
- `npm test`: 27 тестов прошли, включая нагрузочную сцену.
- Chrome 155.0.8059.80, установленный браузер через `channel: chrome`: 4 браузерных сценария прошли.
- Firefox 157.0, сборка Playwright: те же 4 сценария прошли.
- WebKit 18.2, сборка Playwright 1.49.1: те же 4 сценария прошли. После исправления отмены диалога клавишей Escape основной игровой сценарий повторён и прошёл.
- `npm audit`: известных уязвимостей в установленном наборе зависимостей не обнаружено.

Браузерные сценарии проверяют создание людей, все четыре инструмента и клавиши, строительство, паузу, масштаб и перемещение, сохранение и загрузку активного динамита, кратеры, защиту неизвестного формата, подтверждение/отмену нового мира и интерфейс при 900 × 650. Основная сцена проверяется при 1440 × 960. Тестовые миры помещаются в IndexedDB на пустой странице того же origin до запуска приложения; JavaScript игры не подменяется.

Unit-тесты отдельно проверяют размножение только при наличии пары и жилья, детский возраст, ограничение населения, движение по суше при импульсах, бегство от огня и динамита, распространение/тушение/затухание огня, восстановление травы без удаления кратеров, разрушение и очистку индексов, цепные взрывы и остаток очереди, фиксированный шаг, детерминированное продолжение снимка, миграцию v1 → v2, ошибки записи и порядок транзакций.

Расширяемость проверена горючим ящиком: его регистрация не меняет системы огня, дождя и взрыва. Отдельный тест регистрирует 420 дополнительных типов и поражает их общим механизмом взрыва.

## Ограничение проверки Safari

Нативный Safari 16.5.2 не прошёл автоматизированную проверку: SafariDriver отказал в создании сессии, поскольку в браузере отключено `Allow Remote Automation`. Настройки браузера не менялись. Актуальная версия Safari на этой системе отсутствует.

Современная поставка Playwright 1.64.1 не поддерживает macOS 13. Firefox 157 установлен из совместимого пакета macOS 14 и успешно запущен. Для WebKit использована уже установленная сборка 18.2 и соответствующий ей раннер Playwright 1.49.1. Временная копия тех же тестов меняла только пути импортов тестового раннера и исходников. Новая сборка WebKit и нативный Safari остаются непроверенными; прохождение WebKit 18.2 не выдается за проверку Safari.

## Измерения

Сцена в браузере: карта 160 × 112, 300 жителей, 40 первоначальных домов, деревья, горящие объекты и 10 взрывов за 300 шагов. После сцены остаётся 491 сущность. Видимая область — 1440 × 960, DPR 1. Кэш поверхности прогрет перед измерением; изменённые клетки продолжают обновляться.

| Среда | Симуляция, среднее | Симуляция, p95 | Отрисовка, среднее | Отрисовка, p95 |
| --- | ---: | ---: | ---: | ---: |
| Chrome 155 | 1,621 мс | 2,9 мс | 2,046 мс | 2,7 мс |
| Firefox 157 | 2,043 мс | 3 мс | 3,927 мс | 5 мс |
| WebKit 18.2 | 1,910 мс | 3 мс | 2,950 мс | 4 мс |

`p95` — значение, в которое укладывается 95% измеренных шагов. Это время выполнения симуляции и выдачи команд Canvas на CPU в headless-браузере, без обещания определённого FPS, времени GPU или производительности на других компьютерах. Начальная генерация и первый полный рисунок карты в эти значения не включены.

В нагрузочной сцене здоровье жителей увеличено до 100000, чтобы серия взрывов не уменьшала нагрузку ниже 300 человек. Урон применяется, остальные системы работают. В обычной игре у человека 70 здоровья; правила смерти проверяются обычными тестами без этой настройки.

`npm run benchmark` отдельно выполняет 600 шагов и 20 взрывов в Node.js: среднее 1,352 мс, p95 2,032 мс, максимум 6,369 мс. После сцены — 300 жителей и 380 сущностей всего. Результаты браузерного измерения выводятся в консоль и прикладываются Playwright как `performance.json`.

Измерения поддерживают выбранную исходную конфигурацию 160 × 112 и 300 жителей. Верхний защитный предел в 6000 сущностей не измерен и не является заявленной игровой вместимостью. Число разновидностей в реестре отдельно от числа живых объектов.

## Найденные и исправленные ошибки

- В команду инструмента попадали служебные поля вместо чистых координат, что нарушало создание события взрыва. Теперь передаются только `x` и `y`.
- В Firefox CSS мог завершить загрузку после инициализации Canvas. Теперь `ResizeObserver` синхронизирует размер поверхности и камеры с фактическим размером элемента.
- `dialog.returnValue` сохранял прошлое подтверждение, из-за чего Escape при следующем открытии мог создать новый мир. Значение сбрасывается перед каждым открытием; браузерный тест проверяет повторную отмену.

Непроверенные пункты: нативный и актуальный Safari, другие аппаратные конфигурации, длительные многодневные сессии и мобильное управление. Мобильное управление не входит в первую версию.
