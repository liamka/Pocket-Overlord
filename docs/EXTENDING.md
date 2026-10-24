# Расширение игры

## Устройство

`src/core` содержит состояние мира, компоненты, генератор случайных чисел, карту, пространственный индекс и фиксированный игровой шаг. `src/content` собирает пакеты контента: определения сущностей, инструментов, компонентов, воздействий, систем и сценариев. `src/systems` реализует поведение. `src/input` превращает события мыши и клавиатуры в `GameCommand`. `src/render` читает состояние и рисует Canvas. `src/persistence` проверяет, преобразует и сохраняет снимки. `src/ui.ts` и `src/main.ts` связывают браузерные части.

Симуляция не импортирует DOM, Canvas или IndexedDB. Её можно выполнять в Node.js и продолжать из снимка с тем же результатом. Случайные решения используют только `world.rng`; `Math.random`, реальное время и случайность отрисовки не должны влиять на состояние мира.

Сущности хранятся по числовым ID. Состав компонентов индексируется при создании и восстановлении; `world.query('health', 'thermal')` перебирает наиболее узкий индекс. Изменять поля существующего компонента можно. Добавление или удаление ключа компонента у живой сущности требует отдельного метода `World`, синхронно обновляющего индекс; напрямую менять набор ключей нельзя. В первой версии состав задан определением типа.

Пространственный индекс хранит клетки размером 5 игровых единиц. После движения вызывается `world.spatial.update(entity)`. `world.remove(id)` удаляет сущность из всех индексов и освобождает ссылки жителей на разрушенный дом. Для соседей используйте `world.nearby(point, radius)`, а не полный перебор мира.

## Пакет контента

Создайте модуль в `src/content` с объектом `ContentPack` и подключите его в `src/main.ts`: `createRegistry([myPack])`. Тот же реестр передаётся миру, интерфейсу и `SaveService`. Основной контент уже подключён как `coreContent`; тестовые примеры в обычную игру не включены. Регистрация выполняется до создания мира. Системы работающего мира не меняются при последующей регистрации.

```ts
import type { ContentPack } from './registry';

export const myPack: ContentPack = {
  id: 'my-content',
  install(registry) {
    registry.registerEntity({
      id: 'my-content:crate', sprite: 'crate',
      required: ['position', 'health', 'combustible', 'thermal'],
      create: position => ({
        position: { ...position },
        health: { current: 100, max: 100 },
        combustible: { fuel: 50, ignition: 25 },
        thermal: { temperature: 0, wetness: 0, burning: false },
      }),
    });
    registry.registerTool({
      id: 'my-content:crate', label: 'Ящик', hint: 'Разместить ящик',
      radius: 1, color: '#d2b779', category: 'nature',
      apply: (world, point) => {
        if (!world.spawn('my-content:crate', point)) return 'В мире слишком много объектов';
      },
    });
  },
};
```

Пакет сразу даёт горючий, разрушаемый объект и кнопку в категории «Природа». `registerEntity`, `registerTool`, `registerComponent`, `registerEvent`, `registerSystem` и `registerScenario` отклоняют повторный ID. Пакеты изолированы между реестрами. Исполняемый код из сохранений не загружается.

Полный проверяемый пример, включающий все точки расширения: `tests/fixtures/content-pack.ts`. Его проверяют `tests/content.test.ts` и браузерный тест `registered content appears in the toolbar and resumes its saved scenario`.

## Новый тип с существующими свойствами

Зарегистрируйте определение в реестре до создания мира и до проверки сохранений. ID должен быть стабильным и иметь пространство имён. Определение каждый раз возвращает новые объекты компонентов. `required` задаёт обязательные компоненты для загрузки; если поле опущено, их состав вычисляется один раз на тип за декодирование вызовом `create` с отдельным генератором. Поэтому `create` должен быть чистым, а состав компонентов — постоянным.

```ts
registry.registerEntity({
  id: 'my-content:wooden-crate',
  sprite: 'crate',
  create: ({ x, y }) => ({
    position: { x, y },
    health: { current: 100, max: 100 },
    combustible: { fuel: 50, ignition: 25 },
    thermal: { temperature: 0, wetness: 0, burning: false },
    solid: { radius: 0.5 },
  }),
});
```

Ящик уже получает урон, загорается, распространяет огонь, намокает и уничтожается от взрыва. Системы огня, дождя и взрывов менять не нужно. Пример проверен в `tests/helpers.ts` и `tests/simulation.test.ts`; в обычном игровом реестре ящика нет. Имеющееся представление `crate` позволяет проверить расширяемость без новых графических файлов.

Для своего статичного рисунка передайте в `sprite` объект `PixelSprite`: `pixels` — строки символов, `palette` — цвета по символам, `anchor` — точка опоры. Символ без цвета прозрачен. Например: `{ pixels: ['aa', 'aa'], palette: { a: '#d2b779' }, anchor: { x: 1, y: 2 } }`. Renderer кеширует рисунок и выводит одним `drawImage`; описание после регистрации считается неизменяемым. Тот же объект можно передать инструменту как `icon`. Правки общего рисовальщика для статичных пиксельных объектов не нужны; особая анимация по-прежнему требует дополнения слоя отрисовки. Для объектов с радиусом больше 1,2 клетки нужно сначала расширить поиск препятствий в `World.canStand` и валидатор `solid`: текущий предел явно проверяется при загрузке.

## Новый инструмент

Зарегистрируйте `ToolDefinition`: стабильный ID, название, подсказку, клавишу, радиус, цвет и `apply(world, point)`. Для непрерывного воздействия укажите `continuous: true`. `apply` возвращает сообщение об ошибке или ничего. Кнопка автоматически появляется в панели. `category` выбирает `people`, `nature` или `destruction`; без категории инструмент виден во вкладке «Все». `icon` принимает готовый значок (`human`, `rain`, `dynamite`, `rocket`) либо `PixelSprite`. `canApply(world, point)` задаёт проверку для цвета курсора; сам `apply` также обязан проверять размещение. Отсутствие `icon` даёт нейтральный значок.

Управление отправляет `{ kind: 'use-tool', toolId, x, y }` с координатами мира. Новому адаптеру управления, включая будущий сенсорный, достаточно выдавать такие же команды и управлять камерой. Координаты камеры и состояние кнопок не входят в мир.

## Новый компонент

Добавляйте компонент только вместе с использующей его механикой:

1. В модуле контента расширьте `ComponentMap` через `declare module '../core/types'` (путь относительно файла).
2. Там же вызовите `registry.registerComponent(key, validator)`. Валидатор принимает объект неизвестных полей и возвращает `boolean`; используйте проверки из `core/validation.ts`.
3. Включите компонент в `create` и `required` подходящих сущностей; добавьте систему, которая его использует.
4. При изменении уже сохранённых данных добавьте миграцию и проверьте продолжение мира после загрузки.

```ts
declare module '../core/types' {
  interface ComponentMap { 'my-content:charge': { value: number } }
}
registry.registerComponent('my-content:charge', v => number(v.value, 0, 100));
```

Основные компоненты описаны в `CoreComponents`, их проверки — в `content/components.ts`. Дополнительный компонент не требует править эти списки или декодер. Ссылки нового компонента на сущности должны безопасно обрабатывать исчезновение цели в своей системе; общие семейные ссылки остаются частью встроенной модели поселений.

Поля должны быть структурно сериализуемыми: числа, строки, флаги, массивы и простые объекты. Функции, ссылки на DOM и ссылки на другие сущности как объекты в компоненты не помещаются; используйте числовые ID.

## Новая система или воздействие

Система имеет ID и `update(world, dt)`. Подключайте через `registerSystem({ id, after: ['core:fire'], before: ['core:landscape'], update })`. Порядок вычисляется один раз при создании мира; неизвестные зависимости и циклы вызывают ошибку до симуляции. Среди независимых систем сохраняется порядок регистрации. Укажите обе границы, если система должна находиться строго между двумя существующими. Встроенный порядок: дождь → вода → огонь → восстановление ландшафта → движение → жильё и семьи → деревни → дороги → урожай → дипломатия → караваны → потребности и задачи → таймеры взрывов → очередь воздействий. Шаг фиксирован: 1/30 секунды. `FixedClock` использует скорости из `SIMULATION_SPEEDS` (⅕×–40×): меняется число шагов, а не их размер или игровые таймеры. На кадр выделено 6 мс; проверка выполняется после каждого полного шага, поэтому один дорогой шаг может превысить бюджет. At 40×, the step-count guard allows at most 240 steps per frame. При перегрузке просроченные целые шаги отбрасываются, дробный остаток сохраняется; фактическая скорость тогда ниже выбранной. В тестах часов можно передать измеритель стоимости шага для воспроизводимой проверки бюджета. Скрытие вкладки и смена скорости сбрасывают накопленное время. Изменение порядка способно менять результаты продолжения старого мира, поэтому требует проверки совместимости.

Выбирайте цели по свойствам: `health` получает урон, `combustible` вместе с `thermal` горит, `thermal` намокает, `motion` получает импульс. `dwelling` задаёт вместимость дома. Конкретные типы используются только там, где создаётся определённый результат: например, рождение человека или строительство дома.

Последствия помещаются в `world.events`. Доступны `damage`, `heat`, `wet`, `impulse`, `surface`, `blast`. Регулярное воздействие дождя и огня применяет те же функции непосредственно; вторичные последствия, распространение огня и цепные взрывы идут через очередь. `processEvents` ограничивает работу 256 событиями за шаг, включая добавленные при обработке. Остаток переносится и сохраняется. Нельзя обходить лимит рекурсивными вызовами взрывов.

Для своего воздействия расширьте `GameEventMap` через `declare module` в модуле контента и вызовите `registerEvent({ kind, validate, apply })`. Тип аргумента `apply` автоматически определяется по `kind`. Валидатор получает объект и `{ width, height }`; он используется декодером очереди. Например, ключ `'my-content:charge'` с данными `{ target: number; amount: number }` даёт типизированное событие `{ kind: 'my-content:charge', target, amount }`. Общий обработчик и декодер менять не нужно. `systems/effects.ts` регистрирует встроенные воздействия тем же способом. Исключайте изменения уже удалённых целей. События могут хранить ID погибшей сущности: они безопасно пропускаются при обработке.

`world.visual` создаёт только декоративное уведомление. Частицы, анимация воды и другие визуальные эффекты не влияют на урон, таймеры или генератор случайных чисел и не сохраняются. Критичные для игры эффекты, например дождь или летящая ракета, сохраняются в состоянии мира.

`StatusBubbles` handles resident badges. A `love` event shows one heart for the couple for 60 simulation ticks; duplicate partner events do not extend it. Pregnancy never creates a persistent badge, including after reload. Temporary hearts are not saved. The renderer calls `placeHeart` only after land and viewport checks: at most six hearts are drawn, separated by at least 3.5 tiles on one axis. The reusable placement list is cleared each frame and checks at most six entries per candidate. Weapon badges take priority and continue to reflect active war tasks. `drawStatusBubble` supplies the two cached pixel sprites; notification rules do not alter family or combat simulation.

Settlement names use the localized word banks in `src/content/settlement-names.ts`, inspired by [RimWorld's settlement naming rules](https://github.com/Ludeon/RimWorld-ru/blob/master/Core/DefInjected/RulePackDef/RulePacks_Namers_Factions.xml). Patterns combine invented syllables, settlement suffixes, landscape features, ideals and occupations. `settlementName` defaults to English and uses an independent seeded stream. All languages consume the same random draws, preserving the identity of a name when switching languages.

Use `localizedSettlementName` for map and list labels, and `settlementTextLocalizer` before translating saved chronicle messages or displaying diplomatic sides. Cached recognition covers existing Russian names, collision retries and numbered fallbacks; unrecognized custom names remain unchanged. The old eight-name cycle retains its existing upgrade path, including display aliases for historical messages. Changing language does not mutate the world or consume simulation randomness, so save format v11 is unchanged. Keep bank indices, lengths and random draws stable; changing these requires an explicit compatibility path for already saved names. The renderer receives the language from the UI and uses native CJK fonts for Chinese and Japanese labels.

## Сценарий

Сценарий — последовательность событий со своим состоянием: например, несколько волн катастроф или заселение острова. `registerScenario` принимает стабильный `id`, `create(world)`, проверку `validate(state)` и `update(world, state, dt)`. `create` возвращает новый объект данных, а `update` меняет его и вызывает обычные команды/воздействия мира. Возврат `'complete'` завершает сценарий.

Запуск: `world.command({ kind: 'start-scenario', scenarioId: 'my-content:scenario' })` или `world.startScenario(id)`. Повторный запуск активного ID возвращает `false`; неизвестный ID вызывает ошибку. Одновременно допускается 64 сценария. Новый запуск на паузе создаёт начальное состояние, обновления ждут снятия паузы.

Сценарии обновляются в порядке запуска перед обычными системами, один раз за фиксированный шаг. Сценарий, запущенный из другого сценария, впервые обновится на следующем шаге. Накопленные воздействия проходят через общий лимит событий. Используйте `world.tick` и `world.rng`, а не таймеры браузера. Состояние хранится в `snapshot.scenarios`; при восстановлении `create` повторно не вызывается. Общие изменяемые переменные внутри определения не подходят для состояния: они смешивают несколько миров.

`validate` — TypeScript-проверка типа: `(state: unknown): state is MyState`. Разрешены JSON-данные; дополнительно проверяются конечные числа, отсутствие циклов, глубина до 32 и не более 10000 узлов состояния одного сценария. Валидатор запускается при старте и загрузке, а не каждый шаг. При изменении формы состояния нужна миграция сохранения. Проверяемый пример с таймером, RNG, дождём и очередью событий находится в `tests/fixtures/content-pack.ts`.

## Миграция сохранения

1. Увеличьте `SAVE_VERSION` в `src/core/types.ts`.
2. Добавьте преобразование `N → N+1` в карту `migrations` в `src/persistence/schema.ts`.
3. Обновите проверки нового формата. Не переиспользуйте существующие ID типов для другого содержания.
4. Добавьте тест старого снимка, тест текущего снимка и сравнение продолжения симуляции до/после восстановления.
5. Проверьте отклонение неизвестных типов, компонентов, воздействий, сценариев и отсутствующих пакетов; исходная запись должна сохраняться в резервной копии при следующем автосохранении.

Migration v11 → v12 replaces the retired 50×, 500× and 5000× settings with 40×, preserving the world and its paused state. Unsupported values in current saves remain invalid.

Миграция работает с клоном исходных данных. Миграция v1 → v2 добавляет влажность почвы; v2 → v3 — компонент `citizen`, принадлежность домов и состояние `society`. v3 → v4 объединяет парные договоры в союзы и создаёт общие войны с участниками, целями и потерями. Противоречивый старый договор не объединяет явных врагов в один союз; сохраняются наиболее прочные совместимые связи. v4 → v5 добавляет обычную скорость времени, сохраняя состояние паузы. v5 → v6 включает постепенное восстановление существующих кратеров и выжженной земли с нулевым прогрессом. Исходный тип земли под старыми кратерами не сохранялся: для них выбирается трава. v6 → v7 поддерживает караваны; v7 → v8 добавляет `citizen.repair: null` старым жителям; v8 → v9 расширяет набор допустимых скоростей, сохраняя прежнюю скорость и паузу без изменений. v9 → v10 добавляет `contentPacks: ['core']` и пустой список сценариев. Для задачи `repair` сохраняются индекс дорожной клетки, оставшееся время работы и обычный маршрут жителя. Старые дома объединяются в деревни при продолжении симуляции. Декодер сначала последовательно преобразует старые версии, затем проверяет карту, значения компонентов, обязательный состав типа, уникальность ID, ссылки на жильё, эффекты и очередь. Исходная запись остаётся нетронутой, если любой этап не прошёл.

`SaveService` последовательно выполняет транзакции, чтобы завершившаяся позже старая запись не затёрла новый мир. При неудачной загрузке следующая успешная запись атомарно архивирует исходный мир и сохраняет новый; автосохранение остаётся включённым. Снимок хранит ID установленных пакетов в `contentPacks`: отсутствие пакета отклоняется даже тогда, когда он добавлял только систему без собственных сущностей. Новые пакеты можно подключать к старому миру; удаление или изменение сохранённых типов требует миграции.

## Migration and seasonal simulation

`core/seasons.ts` owns the four seasonal definitions and `foodReserve`. A season lasts 1800 fixed ticks; `seasonAt(world.tick)` and `yearAt(world.tick)` derive the calendar from saved simulation time. Agriculture reads growth and harvest yield; intentions read appetite; caravan dispatch preserves the seasonal reserve. Winter fields become dormant and are replanted by ordinary farming in spring. Add seasonal effects through these shared definitions rather than independent browser timers.

`core:migrations` runs after caravans and before intentions. It considers one village every 150 ticks, caps concurrent parties at 16, and performs at most one traveler path search per 15 ticks. Site selection checks 96 candidates with one bounded reachability map. Families leave for peaceful housing when hungry, homeless or at war. Successful departures impose a 1800-tick cooldown. Founding requires two families, at least four pioneers and four residents remaining, population at least 12, surplus food, and accessible fertile plots at least 24 tiles from existing villages.

`society.migrations` stores stable party IDs, origin/destination villages, members, reserved homes, supplies, destination coordinates and departure tick. Members retain their origin while traveling and use the `migrate` task. Housing assignments and births must respect `reservedBeds`; agriculture and military recruitment exclude travelers. Arrival assigns homes and transfers remaining food without creating supplies. A destroyed or hostile destination, no surviving adult, or a journey longer than 3600 ticks cancels the move. Death removes the member and releases the corresponding reservation. Refugees still avoid enemy troops; disaster avoidance is unchanged.

Save migration v10 → v11 adds empty parties, `nextMigrationId: 1` and per-village migration cooldowns. Validation checks member identity, housing capacity including reservations, village references, bounded supplies and coordinates. The calendar needs no new saved field. Tests in `migration.test.ts`, `seasons.test.ts` and browser scenarios cover travel, founding, winter supplies, damaged destinations, swimming, pause, deterministic reload and older saves.

## Жизнь поселений

`citizen` хранит деревню, пару, родителей, голод, беременность и текущую задачу с маршрутом. `farm` хранит принадлежность поля и рост урожая; поле использует общие компоненты огня, дождя и урона. `society` сохраняет деревни, еду, отношения, строящиеся дороги, войны и последние 40 событий. События ограничены 300 символами, в том числе для больших союзов. Удаление сущности очищает ссылки на партнёра и цель; исторические ID родителей сохраняются.

`navigation.ts` строит ограниченные размером карты маршруты по суше с учётом твёрдых объектов. `society.ts` обновляет деревни, поля и дороги, а `diplomacy.ts` — союзы и войны раз в секунду; решения жителей и семьи пересматриваются раз в полсекунды. Движение и опасности остаются на фиксированном шаге. Любая новая связь между сущностями должна проверяться в декодере и корректно обрабатываться при удалении цели.

Союз — группа взаимно дружественных деревень; все пары внутри группы имеют `status: alliance`. `formAlliance` требует согласия участников и подключает новых союзников к действующей войне. `declareWar` создаёт общий поход или присоединяет целый союз к одной из сторон существующего. `War` хранит стабильный ID, стороны, сроки сбора, место сбора, цель, исходную численность и потери. `campaignObjective` задаёт общую цель воинов, а `endWar` завершает войну для всех участников и очищает их боевые задачи. Не меняйте статус одной пары для начала или окончания войны: это нарушит обязательства остальных участников. Декодер проверяет составы сторон, договоры и принадлежность целей.

`TerrainMap.set` учитывает повреждение земли: создаёт запись `recovery` для кратера или выжженной клетки, запоминает траву или песок и сбрасывает возраст при повторном ударе. Замена на здоровый тип удаляет запись. Для игровых изменений поверхности используйте этот метод, не меняйте `tiles` напрямую. `landscape.ts` раз в игровую секунду обновляет только повреждённые клетки; огонь рядом обнуляет их прогресс. Кратер сначала становится выжженной землёй, затем возвращается природное покрытие. Дороги, уничтоженные взрывом, без рабочих зарастают травой; сущности не воссоздаются. `road-repair.ts` назначает взрослым жителям ремонт уже проложенных участков. Прогресс идёт только рядом с повреждением; поиск путей ограничен четырьмя запросами за игровую секунду. Готовность дороги проверяется по фактическому покрытию через `roadIsIntact`, а `Road.built` остаётся указателем первоначального строительства. `recovery` сохраняется и проверяется вместе с картой, а смена видимой стадии отмечает клетку для перерисовки.
