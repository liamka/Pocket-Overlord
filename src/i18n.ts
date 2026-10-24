export const languages = [
  { id: 'en', name: 'English' },
  { id: 'ru', name: 'Русский' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'ja', name: '日本語' },
  { id: 'es', name: 'Español' },
] as const;
export type Language = typeof languages[number]['id'];
export const DEFAULT_LANGUAGE: Language = 'en';
// Keep the original storage key so the rename preserves existing language preferences.
export const LANGUAGE_KEY = 'little-world:language';
export const isLanguage = (value: unknown): value is Language => languages.some(language => language.id === value);

// The Russian source text also identifies messages in existing world chronicles.
// Each row contains English, Simplified Chinese, Japanese and Spanish, in that order.
export const messages = {
  'Pocket World — пиксельная песочница': ['Pocket World — pixel sandbox', 'Pocket World — 像素沙盒', 'Pocket World — ピクセルサンドボックス', 'Pocket World — sandbox de píxeles'],
  'Pocket World — пиксельная песочница. Заселяйте остров, создавайте поселения и меняйте мир пятью инструментами.': ['Pocket World is a pixel sandbox. Populate an island, build settlements and shape the world with five tools.', 'Pocket World是一款像素沙盒游戏。让居民来到岛上，建立聚落，用五种工具改变世界。', 'Pocket Worldはピクセルサンドボックスです。島に住民を増やし、集落を築き、5つのツールで世界を変えましょう。', 'Pocket World es un sandbox de píxeles. Puebla una isla, crea asentamientos y transforma el mundo con cinco herramientas.'],
  'Ваш собственный остров': ['Your own island', '属于你的岛屿', 'あなただけの島', 'Tu propia isla'],
  'Остров {id} / ваша маленькая вселенная': ['Island {id} / your little universe', '岛屿 {id} / 你的小小宇宙', '島 {id} / あなたの小さな宇宙', 'Isla {id} / tu pequeño universo'],
  'Карта острова. Выберите инструмент и щёлкните по карте.': ['Island map. Choose a tool and click the map.', '岛屿地图。选择工具后点击地图。', '島の地図。ツールを選んで地図をクリックしてください。', 'Mapa de la isla. Elige una herramienta y haz clic en el mapa.'],
  'Статистика мира': ['World statistics', '世界统计', '世界の統計', 'Estadísticas del mundo'],
  'Состояние мира': ['World status', '世界状态', '世界の状態', 'Estado del mundo'],
  'День {day}': ['Day {day}', '第 {day} 天', '{day}日目', 'Día {day}'],
  'жителей': ['residents', '居民', '住民', 'habitantes'],
  'домов': ['houses', '房屋', '家屋', 'casas'],
  'Поселения': ['Settlements', '聚落', '集落', 'Asentamientos'],
  'Семей': ['Families', '家庭', '家族', 'Familias'],
  'Детей': ['Children', '儿童', '子供', 'Niños'],
  'Полей': ['Fields', '农田', '畑', 'Campos'],
  'Состав союзов': ['Alliance members', '联盟成员', '同盟の構成', 'Miembros de las alianzas'],
  'Совместные войны': ['Coalition wars', '联合战争', '連合の戦争', 'Guerras de coalición'],
  'Летопись мира': ['World chronicle', '世界纪事', '世界の記録', 'Crónica del mundo'],
  'Мир на паузе': ['World paused', '世界已暂停', '一時停止中', 'Mundo en pausa'],
  'Всё начинается с одного человека': ['It all starts with one person', '一切从一个人开始', 'すべては一人の住民から', 'Todo empieza con una persona'],
  'Выберите свободное место на карте': ['Choose an open spot on the map', '在地图上选择一处空位', '地図上の空いている場所を選んでください', 'Elige un lugar libre en el mapa'],
  'Выбранный инструмент': ['Selected tool', '已选工具', '選択中のツール', 'Herramienta seleccionada'],
  'Инструменты мира': ['World tools', '世界工具', '世界のツール', 'Herramientas del mundo'],
  'Категории инструментов': ['Tool categories', '工具分类', 'ツールの分類', 'Categorías de herramientas'],
  'Все инструменты': ['All tools', '全部工具', 'すべてのツール', 'Todas las herramientas'],
  'Люди': ['People', '人类', '人々', 'Personas'],
  'Природа': ['Nature', '自然', '自然', 'Naturaleza'],
  'Разрушение': ['Destruction', '破坏', '破壊', 'Destrucción'],
  'Управление миром': ['World controls', '世界控制', '世界の操作', 'Controles del mundo'],
  'Новый мир': ['New world', '新世界', '新しい世界', 'Nuevo mundo'],
  'Уменьшить масштаб': ['Zoom out', '缩小', '縮小', 'Alejar'],
  'Показать весь остров': ['Show entire island', '显示整个岛屿', '島全体を表示', 'Mostrar toda la isla'],
  'Увеличить масштаб': ['Zoom in', '放大', '拡大', 'Acercar'],
  'Выбор инструмента': ['Choose a tool', '选择工具', 'ツールを選択', 'Elegir herramienta'],
  'Человек': ['Human', '人类', '人間', 'Humano'],
  'Динамит': ['Dynamite', '炸药', 'ダイナマイト', 'Dinamita'],
  'Дождь': ['Rain', '雨', '雨', 'Lluvia'],
  'Ракета': ['Rocket', '火箭', 'ロケット', 'Cohete'],
  'Создайте человека на суше или в море. Вдали от берега он утонет.': ['Place a human on land or at sea. Too far from shore, they will drown.', '在陆地或海中放置人类。离岸太远就会溺亡。', '陸でも海でも人間を配置できます。岸から遠すぎると溺れます。', 'Coloca un humano en tierra o en el mar. Lejos de la costa se ahogará.'],
  'Щёлкните для установки. Взрыв через 2 секунды.': ['Click to place. Explodes after 2 seconds.', '点击放置，2秒后爆炸。', 'クリックで設置。2秒後に爆発します。', 'Haz clic para colocarla. Explota en 2 segundos.'],
  'Удерживайте кнопку: тушите огонь и возвращайте траву.': ['Hold to put out fires and regrow grass.', '按住鼠标按钮灭火，让草地重新生长。', 'ボタンを押し続けて消火し、草を再生させます。', 'Mantén pulsado para apagar incendios y regenerar la hierba.'],
  'Выберите точку. Ракета прилетит сверху.': ['Choose a target. A rocket strikes from above.', '选择目标，火箭将从上方袭来。', '目標を選ぶと、上空からロケットが飛来します。', 'Elige un objetivo. El cohete llegará desde arriba.'],
  'Масштаб карты': ['Map zoom', '地图缩放', '地図の倍率', 'Escala del mapa'],
  'Колесо — масштаб · ПКМ — перемещение': ['Wheel: zoom · Right drag: pan', '滚轮：缩放 · 右键拖动：平移', 'ホイール：拡大縮小 · 右ドラッグ：移動', 'Rueda: zoom · Arrastrar con botón derecho: mover'],
  'Скорость игры': ['Game speed', '游戏速度', 'ゲーム速度', 'Velocidad del juego'],
  'Выбрать скорость': ['Choose speed', '选择速度', '速度を選択', 'Elegir velocidad'],
  'Уменьшить скорость': ['Decrease speed', '降低速度', '速度を下げる', 'Reducir velocidad'],
  'Увеличить скорость': ['Increase speed', '提高速度', '速度を上げる', 'Aumentar velocidad'],
  'медленно': ['slow', '慢速', '低速', 'lento'],
  'обычно': ['normal', '正常', '通常', 'normal'],
  'максимум': ['maximum', '最高', '最大', 'máximo'],
  'Продолжить время · Пробел': ['Resume time · Space', '继续时间 · 空格键', '時間を再開 · スペース', 'Reanudar el tiempo · Espacio'],
  'Стоп': ['Stop', '暂停', '停止', 'Pausar'],
  'Старт': ['Play', '开始', '再生', 'Iniciar'],
  'Остановить время · Пробел': ['Pause time · Space', '暂停时间 · 空格键', '時間を停止 · スペース', 'Pausar el tiempo · Espacio'],
  'Запустить с обычной скоростью': ['Run at normal speed', '以正常速度运行', '通常速度で再生', 'Iniciar a velocidad normal'],
  'Ускорить время вдвое': ['Run at double speed', '以2倍速度运行', '2倍速で再生', 'Velocidad doble'],
  'Ускорить время вчетверо': ['Run at quadruple speed', '以4倍速度运行', '4倍速で再生', 'Velocidad cuádruple'],
  'Для игры нужны мышь и клавиатура': ['A mouse and keyboard are required', '游戏需要鼠标和键盘', 'マウスとキーボードが必要です', 'Se necesita ratón y teclado'],
  'Начать новый мир?': ['Start a new world?', '开始新世界？', '新しい世界を始めますか？', '¿Crear un mundo nuevo?'],
  'На месте этого острова появится новый. Текущий мир будет заменён.': ['A new island will replace this one. Your current world will be replaced.', '新岛屿将取代当前岛屿。当前世界将被替换。', 'この島は新しい島に置き換わります。現在の世界は上書きされます。', 'Una isla nueva sustituirá a esta. El mundo actual será reemplazado.'],
  'Оставить этот': ['Keep this world', '保留当前世界', 'この世界を残す', 'Conservar este mundo'],
  'Создать мир': ['Create world', '创建世界', '世界を作成', 'Crear mundo'],
  'Настройки': ['Settings', '设置', '設定', 'Ajustes'],
  'Язык': ['Language', '语言', '言語', 'Idioma'],
  'Готово': ['Done', '完成', '完了', 'Listo'],
  'Не удалось запомнить язык. Выбор действует до перезагрузки страницы.': ['Could not remember your language. It will apply until you reload the page.', '无法保存语言设置。当前选择仅在刷新页面前有效。', '言語設定を保存できませんでした。ページを再読み込みするまで有効です。', 'No se pudo guardar el idioma. La selección se mantendrá hasta recargar la página.'],
  'Загрузка мира…': ['Loading world…', '正在加载世界…', '世界を読み込み中…', 'Cargando mundo…'],
  'Сохраняем новый мир…': ['Saving new world…', '正在保存新世界…', '新しい世界を保存中…', 'Guardando el nuevo mundo…'],
  'Мир сохранён': ['World saved', '世界已保存', '世界を保存しました', 'Mundo guardado'],
  'Мир восстановлен': ['World restored', '世界已恢复', '世界を復元しました', 'Mundo restaurado'],
  'Автосохранение каждые 5 с': ['Autosave every 5 seconds', '每5秒自动保存', '5秒ごとに自動保存', 'Guardado automático cada 5 s'],
  'Не удалось сохранить': ['Could not save', '保存失败', '保存できませんでした', 'No se pudo guardar'],
  'Мир не сохранён. {error}. Игра продолжает работать.': ['World not saved. {error}. You can keep playing.', '世界未保存。{error}。游戏仍可继续。', '世界を保存できませんでした。{error}。ゲームは続行できます。', 'El mundo no se ha guardado. {error}. Puedes seguir jugando.'],
  'Хранилище недоступно': ['Storage unavailable', '存储不可用', 'ストレージを利用できません', 'Almacenamiento no disponible'],
  'Закройте другую вкладку игры, чтобы открыть сохранение': ['Close the other game tab to open the save', '请关闭其他游戏标签页以打开存档', 'セーブを開くには、ゲームの他のタブを閉じてください', 'Cierra la otra pestaña del juego para abrir la partida'],
  'Не удалось прочитать мир': ['Could not read the world', '无法读取世界', '世界を読み込めませんでした', 'No se pudo leer el mundo'],
  'Не удалось сохранить мир': ['Could not save the world', '无法保存世界', '世界を保存できませんでした', 'No se pudo guardar el mundo'],
  'На острове уже {count} жителей': ['The island already has {count} residents', '岛上已有 {count} 位居民', '島の住民はすでに{count}人います', 'La isla ya tiene {count} habitantes'],
  'В мире слишком много объектов': ['There are too many objects in the world', '世界中的对象过多', '世界のオブジェクト数が上限に達しています', 'Hay demasiados objetos en el mundo'],
  'Выберите точку на карте': ['Choose a point on the map', '请选择地图上的位置', '地図上の場所を選んでください', 'Elige un punto del mapa'],
  '{count} жителей · {food} еды': ['Residents: {count} · Food: {food}', '居民：{count} · 食物：{food}', '住民：{count} · 食料：{food}', 'Habitantes: {count} · Comida: {food}'],
  ' · {count} голодают': [' · Hungry: {count}', ' · 饥饿：{count}', ' · 空腹：{count}', ' · Con hambre: {count}'],
  'Дорог': ['Roads', '道路', '道路', 'Caminos'],
  'Союзов': ['Alliances', '联盟', '同盟', 'Alianzas'],
  'Войн': ['Wars', '战争', '戦争', 'Guerras'],
  'Союз · поселений: {count}': ['Alliance · Settlements: {count}', '联盟 · 聚落：{count}', '同盟 · 集落：{count}', 'Alianza · Asentamientos: {count}'],
  'Сбор войск': ['Mustering', '集结部队', '部隊集結中', 'Reuniendo tropas'],
  'Совместный поход': ['Joint campaign', '联合远征', '共同遠征', 'Campaña conjunta'],
  '{a} против {b}': ['{a} vs {b}', '{a} 对 {b}', '{a} 対 {b}', '{a} contra {b}'],
  'против': ['against', '对抗', '対', 'contra'],
  'Цель: {target} · Потери {a} / {b}': ['Target: {target} · Losses {a} / {b}', '目标：{target} · 损失 {a} / {b}', '目標：{target} · 損失 {a} / {b}', 'Objetivo: {target} · Bajas {a} / {b}'],
  'Основана деревня {village}': ['Settlement founded: {village}', '聚落建立：{village}', '集落が誕生：{village}', 'Asentamiento fundado: {village}'],
  'Деревня {village} опустела': ['{village} has been abandoned', '{village} 已被遗弃', '{village} は無人になりました', '{village} ha quedado abandonado'],
  '{village}: жители заложили первые поля': ['{village}: residents planted their first fields', '{village}：居民开垦了第一批农田', '{village}：住民が最初の畑を開きました', '{village}: los habitantes crearon sus primeros campos'],
  'Дорога: {a} — {b}': ['Road: {a} — {b}', '道路：{a} — {b}', '道路：{a} — {b}', 'Camino: {a} — {b}'],
  '{village}: собран первый урожай': ['{village}: the first harvest is in', '{village}：迎来了第一次收获', '{village}：最初の収穫を迎えました', '{village}: se recogió la primera cosecha'],
  '{village}: образовалась новая семья': ['{village}: a new family has formed', '{village}：一个新家庭诞生了', '{village}：新しい家族が誕生しました', '{village}: se ha formado una nueva familia'],
  '{village}: родился ребёнок': ['{village}: a child was born', '{village}：一个孩子出生了', '{village}：子供が生まれました', '{village}: ha nacido un niño'],
  '{side} вступает в войну на стороне союзников': ['{side} joins the war alongside its allies', '{side} 加入战争支援盟友', '{side} が同盟国を支援して参戦しました', '{side} entra en guerra junto a sus aliados'],
  'Создан союз: {side}': ['Alliance formed: {side}', '联盟成立：{side}', '同盟が結成：{side}', 'Alianza formada: {side}'],
  '{side} выходит из союза': ['{side} leaves the alliance', '{side} 退出联盟', '{side} が同盟を離脱しました', '{side} abandona la alianza'],
  'Коалиция растёт: {side} вступает в общую войну': ['The coalition grows: {side} joins the war', '联合阵营壮大：{side} 加入共同战争', '連合が拡大：{side} が参戦しました', 'La coalición crece: {side} se une a la guerra'],
  'Война: {a} против {b}. Сбор войск': ['War: {a} against {b}. Troops are gathering', '战争：{a} 对抗 {b}。部队正在集结', '戦争：{a} 対 {b}。部隊を集結中', 'Guerra: {a} contra {b}. Las tropas se reúnen'],
  'Общее перемирие: {a} — {b}. {reason}': ['General truce: {a} — {b}. {reason}', '全面停战：{a} — {b}。{reason}', '全面休戦：{a} — {b}。{reason}', 'Tregua general: {a} — {b}. {reason}'],
  'Одна из сторон больше не может сражаться': ['One side can no longer fight', '一方已无力继续作战', '一方が戦闘を継続できなくなりました', 'Uno de los bandos ya no puede luchar'],
  'Слишком большие потери': ['Losses are too heavy', '损失过于惨重', '損失が大きすぎます', 'Las bajas son demasiado altas'],
  'Стороны устали от войны': ['Both sides are weary of war', '双方已厌倦战争', '双方が戦争に疲弊しています', 'Ambos bandos están agotados por la guerra'],
  'Не хватает припасов': ['Supplies are running low', '补给不足', '物資が不足しています', 'Faltan suministros'],
  'Общий поход на {target}': ['Joint campaign against {target}', '联合进军 {target}', '{target} への共同遠征', 'Campaña conjunta contra {target}'],
  '{donor} отправляет еду союзникам в {receiver}': ['{donor} sends food to allies in {receiver}', '{donor} 向 {receiver} 的盟友运送食物', '{donor} が {receiver} の同盟国に食料を送りました', '{donor} envía comida a sus aliados en {receiver}'],
  'Караванов': ['Caravans', '商队', '隊商', 'Caravanas'],
  'Караван: {a} → {b}, еды: {count}': ['Caravan: {a} → {b}, food: {count}', '商队：{a} → {b}，食物：{count}', '隊商：{a} → {b}、食料：{count}', 'Caravana: {a} → {b}, comida: {count}'],
  'Караван прибыл в {village}: доставлено еды — {count}': ['Caravan arrived in {village}: delivered {count} food', '商队抵达 {village}：送达食物 {count}', '隊商が{village}に到着：食料{count}を届けました', 'La caravana llegó a {village}: entregó {count} de comida'],
  'Караван возвращается в {village}': ['Caravan returns to {village}', '商队返回 {village}', '隊商が{village}に戻ります', 'La caravana regresa a {village}'],
} as const satisfies Record<string, readonly [string, string, string, string]>;

/** New copy is authored in English; legacy Russian keys remain valid for saved chronicles. */
export const englishMessages = {
  'Thunderstorm': ['Гроза', '雷暴', '雷雨', 'Tormenta eléctrica'],
  'Click or hold to summon a thunderstorm. Lightning sets people, houses, trees and other flammable objects on fire.': ['Щёлкните или удерживайте кнопку, чтобы вызвать грозу. Молнии поджигают людей, дома, деревья и другие горючие объекты.', '点击或按住鼠标召唤雷暴。闪电会点燃人、房屋、树木和其他可燃物。', 'クリックまたは長押しで雷雨を呼びます。雷は人や家、木などの燃えるものに火をつけます。', 'Haz clic o mantén pulsado para invocar una tormenta eléctrica. Los rayos incendian personas, casas, árboles y otros objetos inflamables.'],
  'Too many active thunderstorms': ['Слишком много гроз одновременно', '同时存在的雷暴过多', '雷雨が多すぎます', 'Hay demasiadas tormentas activas'],
  'Biomes': ['Биомы', '生物群系', 'バイオーム', 'Biomas'],
  'Peoples and creatures': ['Народы и существа', '种族与生物', '種族と生き物', 'Pueblos y criaturas'],
  'Mixed biomes': ['Разные биомы', '混合群系', '混合バイオーム', 'Biomas mixtos'],
  'Grassland': ['Луга', '草原', '草原', 'Pradera'],
  'Savanna': ['Саванна', '稀树草原', 'サバンナ', 'Sabana'],
  'Desert': ['Пустыня', '沙漠', '砂漠', 'Desierto'],
  'Jungle': ['Джунгли', '丛林', 'ジャングル', 'Selva'],
  'Swamp': ['Болото', '沼泽', '沼地', 'Pantano'],
  'Permafrost': ['Вечная мерзлота', '永冻土', '永久凍土', 'Suelo congelado'],
  'Peoples': ['Народы', '种族', '種族', 'Pueblos'],
  'Grassland seeds': ['Семена лугов', '草原种子', '草原の種', 'Semillas de pradera'],
  'Savanna seeds': ['Семена саванны', '稀树草原种子', 'サバンナの種', 'Semillas de sabana'],
  'Desert seeds': ['Семена пустыни', '沙漠种子', '砂漠の種', 'Semillas de desierto'],
  'Jungle seeds': ['Семена джунглей', '丛林种子', 'ジャングルの種', 'Semillas de selva'],
  'Swamp seeds': ['Семена болота', '沼泽种子', '沼地の種', 'Semillas de pantano'],
  'Permafrost seeds': ['Семена вечной мерзлоты', '永冻土种子', '永久凍土の種', 'Semillas de permafrost'],
  'Plant meadows and broadleaf trees. Balanced soil for farming.': ['Создайте луга и лиственные леса. Подходящая почва для земледелия.', '种植草地和阔叶树。土壤适宜耕作。', '草地と広葉樹を育てます。農業に適した土壌です。', 'Crea praderas y árboles de hoja ancha. Suelo equilibrado para cultivar.'],
  'Plant golden grass and acacias. Crops grow more slowly.': ['Создайте золотистые луга с акациями. Урожай растёт медленнее.', '种植金色草地和金合欢树。作物生长较慢。', '金色の草とアカシアを育てます。作物の成長は遅くなります。', 'Planta hierba dorada y acacias. Los cultivos crecen más despacio.'],
  'Spread desert sand and cacti. Poor soil and slower travel.': ['Создайте пустыню с кактусами. Бедная почва замедляет рост урожая, песок — движение.', '铺开沙漠和仙人掌。土壤贫瘠，行走较慢。', '砂漠とサボテンを広げます。土壌は痩せ、移動も遅くなります。', 'Extiende arena desértica y cactus. Suelo pobre y desplazamiento más lento.'],
  'Grow lush jungle and palms. Rich soil helps crops grow faster.': ['Создайте густые джунгли с пальмами. Плодородная почва ускоряет рост урожая.', '种植茂密丛林和棕榈树。肥沃的土壤加快作物生长。', '緑豊かなジャングルとヤシを育てます。肥沃な土で作物が早く育ちます。', 'Crea una selva frondosa con palmeras. El suelo fértil acelera los cultivos.'],
  'Grow wetlands and mangroves. Mud slows travel and crop growth.': ['Создайте болота с мангровыми деревьями. Грязь замедляет движение и рост урожая.', '种植湿地和红树林。泥泞减慢行走与作物生长。', '湿地とマングローブを育てます。泥で移動と作物の成長が遅くなります。', 'Crea humedales y manglares. El barro ralentiza el movimiento y los cultivos.'],
  'Spread lasting snow and conifers. Cold soil slows crops and travel.': ['Создайте вечные снега с хвойными деревьями. Холод замедляет рост урожая и движение.', '铺开常年积雪和针叶树。冻土减慢作物生长与行走。', '解けない雪と針葉樹を広げます。寒い土で作物の成長と移動が遅くなります。', 'Extiende nieves perpetuas y coníferas. El frío ralentiza los cultivos y el movimiento.'],
  'Wheel: zoom · Left-drag: plant · Right-drag: pan': ['Колесо — масштаб · ЛКМ — посадка · ПКМ — карта', '滚轮：缩放 · 左键拖动：种植 · 右键拖动：平移', 'ホイール：ズーム · 左ドラッグ：植える · 右ドラッグ：移動', 'Rueda: zoom · Arrastrar izq.: plantar · Arrastrar der.: mover'],
  'Elf': ['Эльф', '精灵', 'エルフ', 'Elfo'],
  'Orc': ['Орк', '兽人', 'オーク', 'Orco'],
  'Dwarf': ['Гном', '矮人', 'ドワーフ', 'Enano'],
  'Spawn an elf. Elves are swift and long-lived, with leaf-roofed homes. They distrust orcs and dwarves.': ['Создайте эльфа. Эльфы быстры и живут долго, строят дома с лиственными крышами. Не доверяют оркам и гномам.', '创造一个精灵。精灵行动敏捷、寿命悠长，房屋以树叶为顶。他们不信任兽人和矮人。', 'エルフを召喚。素早く長寿で、葉葺きの家を建てます。オークやドワーフを警戒します。', 'Crea un elfo. Los elfos son rápidos y longevos, con casas de tejado de hojas. Desconfían de orcos y enanos.'],
  'Spawn an orc. Orcs are strong, recover quickly and build rugged huts. They are hostile toward other peoples.': ['Создайте орка. Орки сильны, быстро восстанавливаются и строят грубые хижины. Враждебны к другим народам.', '创造一个兽人。兽人强壮、恢复迅速，建造粗犷的小屋。他们对其他种族怀有敌意。', 'オークを召喚。力が強く、回復が速く、無骨な小屋を建てます。他の種族に敵対的です。', 'Crea un orco. Los orcos son fuertes, se recuperan rápido y construyen chozas rústicas. Son hostiles hacia otros pueblos.'],
  'Spawn a dwarf. Dwarves are sturdy, slow and long-lived. They build durable stone homes and distrust elves and orcs.': ['Создайте гнома. Гномы крепки, медлительны и живут долго. Строят прочные каменные дома, не доверяют эльфам и оркам.', '创造一个矮人。矮人坚韧、行动缓慢且长寿。他们建造坚固的石屋，不信任精灵和兽人。', 'ドワーフを召喚。頑丈で足が遅く、長寿です。丈夫な石の家を建て、エルフやオークを警戒します。', 'Crea un enano. Los enanos son robustos, lentos y longevos. Construyen casas de piedra resistentes y desconfían de elfos y orcos.'],
  'Pocket World is a pixel sandbox. Populate an island, build settlements and shape the world with seven tools.': ['Pocket World — пиксельная песочница. Заселяйте остров, создавайте поселения и меняйте мир семью инструментами.', 'Pocket World是一款像素沙盒游戏。让居民来到岛上，建立聚落，用七种工具改变世界。', 'Pocket Worldはピクセルサンドボックスです。島に住民を増やし、集落を築き、7つのツールで世界を変えましょう。', 'Pocket World es un sandbox de píxeles. Puebla una isla, crea asentamientos y transforma el mundo con siete herramientas.'],
  'Island shape': ['Форма острова', '岛屿形状', '島の形', 'Forma de la isla'],
  'Preview': ['Превью', '预览', 'プレビュー', 'Vista previa'],
  'Preview of the new island': ['Превью нового острова', '新岛屿预览', '新しい島のプレビュー', 'Vista previa de la nueva isla'],
  'World seed': ['Сид мира', '世界种子', 'ワールドのシード値', 'Semilla del mundo'],
  'Randomize': ['Случайный сид', '随机生成', 'ランダム生成', 'Generar al azar'],
  'Copy seed': ['Копировать сид', '复制种子', 'シード値をコピー', 'Copiar semilla'],
  'Seed copied': ['Сид скопирован', '种子已复制', 'シード値をコピーしました', 'Semilla copiada'],
  'Could not copy. Copy the selected seed manually.': ['Не удалось скопировать. Скопируйте выделенный сид вручную.', '无法复制。请手动复制选中的种子。', 'コピーできませんでした。選択されたシード値を手動でコピーしてください。', 'No se pudo copiar. Copia manualmente la semilla seleccionada.'],
  'Enter a whole number from 0 to 4294967295.': ['Введите целое число от 0 до 4294967295.', '请输入0到4294967295之间的整数。', '0から4294967295までの整数を入力してください。', 'Introduce un número entero entre 0 y 4294967295.'],
  'Use the same world settings to recreate this map.': ['Чтобы повторить карту, выберите те же настройки мира.', '使用相同的世界设置来重现这张地图。', '同じマップを再現するには、同じワールド設定を使用してください。', 'Usa los mismos ajustes del mundo para recrear este mapa.'],
  'Random': ['Случайный', '随机', 'ランダム', 'Aleatorio'],
  'Dragon': ['Дракон', '龙', 'ドラゴン', 'Dragón'],
  'Harbor': ['Гавань', '港口', '港', 'Puerto'],
  'Ship': ['Корабль', '船', '船', 'Barco'],
  'Place a harbor on an open coast. Coastal villages also build harbors and launch fishing and trade ships.': ['Поставьте гавань на свободном берегу. Прибрежные поселения также строят гавани и спускают рыбацкие и торговые суда.', '在开阔的海岸建造港口。沿海村庄也会建港并派出渔船和商船。', '開けた海岸に港を建設。沿岸の村も港を建て、漁船や商船を出航させます。', 'Coloca un puerto en una costa despejada. Los pueblos costeros también construyen puertos y botan barcos pesqueros y mercantes.'],
  'Launch a sailboat in open water. Ships fish and return to nearby harbors; larger ships trade between settlements.': ['Спустите парусник на открытую воду. Корабли ловят рыбу и возвращаются в гавани; крупные суда торгуют между поселениями.', '在开阔水域放置帆船。船只捕鱼后返回附近港口，大型船只在聚落间贸易。', '広い水域に帆船を出航。漁船は近くの港に戻り、大型船は集落間で交易します。', 'Bota un velero en aguas abiertas. Los barcos pescan y regresan a los puertos cercanos; los grandes comercian entre poblados.'],
  'Choose an open coast with room for a pier': ['Выберите свободный берег с местом для причала', '选择有空间建码头的开阔海岸', '桟橋を建てられる開けた海岸を選んでください', 'Elige una costa despejada con espacio para un muelle'],
  'Choose open water away from the shore': ['Выберите открытую воду вдали от берега', '选择远离海岸的开阔水域', '岸から離れた広い水域を選んでください', 'Elige aguas abiertas lejos de la orilla'],
  'Flying saucer': ['Летающая тарелка', '飞碟', '空飛ぶ円盤', 'Platillo volante'],
  'Call in a flying saucer from a screen corner. It hovers over its targets and fires a destructive green beam.': ['Вызовите летающую тарелку из-за угла экрана. Она зависает над целями и разрушает их зелёным лучом.', '召唤一架从屏幕角落飞入的飞碟。它悬停在目标上方，发射具有破坏力的绿色光束。', '画面の隅から飛来する円盤を召喚。標的の上に静止し、緑色の破壊光線を放ちます。', 'Llama a un platillo volante desde una esquina de la pantalla. Se detiene sobre sus objetivos y dispara un rayo verde destructivo.'],
  'Giant Kaiju': ['Большой кайдзю', '巨型怪兽', '巨大怪獣', 'Kaiju gigante'],
  'Click to summon a reptilian titan. WASD or arrows: move. Aim with the mouse; hold left click for atomic breath. Select another power to let it rampage. Right-drag: pan.': ['Щёлкните, чтобы призвать гигантского ящера. WASD или стрелки — ходьба. Наводите мышью, удерживайте ЛКМ для атомного дыхания. Выберите другую силу, чтобы он разрушал всё сам. ПКМ — перемещение карты.', '点击召唤爬行巨兽。WASD或方向键移动，鼠标瞄准，按住左键释放原子吐息。选择其他能力后，它会自行肆虐。右键拖动地图。', 'クリックで巨大な爬虫類を召喚。WASDか矢印キーで移動、マウスで照準、左ボタン長押しで放射熱線。他の力を選ぶと自動で暴れます。右ドラッグでマップ移動。', 'Haz clic para invocar un titán reptiliano. WASD o flechas: mover. Apunta con el ratón; mantén el clic izquierdo para lanzar aliento atómico. Elige otro poder para que arrase por su cuenta. Arrastra con el botón derecho para mover el mapa.'],
  'Spawn a dragon. It flies over land and sea, breathing fire on people, forests and settlements.': ['Создайте дракона. Он летает над сушей и морем, сжигая людей, леса и поселения огненным дыханием.', '召唤一条龙。它飞越陆地和海洋，向人群、森林和聚落喷火。', 'ドラゴンを召喚。陸と海の上を飛び、人々や森、集落に炎を吐きます。', 'Crea un dragón. Vuela sobre tierra y mar, lanzando fuego sobre personas, bosques y poblados.'],
  'Too many objects in the world': ['Слишком много объектов в мире', '世界中的物体过多', 'ワールド内のオブジェクトが多すぎます', 'Demasiados objetos en el mundo'],
  'Turtle': ['Черепаха', '海龟', 'カメ', 'Tortuga'],
  'Phoenix': ['Феникс', '凤凰', 'フェニックス', 'Fénix'],
  'Kraken': ['Кракен', '克拉肯', 'クラーケン', 'Kraken'],
  'Whale': ['Кит', '鲸鱼', 'クジラ', 'Ballena'],
  'Yin and Yang': ['Инь и Ян', '阴阳', '陰陽', 'Yin y Yang'],
  'Choose a target. A rocket flies in from a random direction.': ['Выберите цель. Ракета прилетит со случайного направления.', '选择目标。火箭将从随机方向飞来。', '目標を選ぶと、ランダムな方向からロケットが飛来します。', 'Elige un objetivo. El cohete llegará desde una dirección aleatoria.'],
  'Creating world…': ['Создаём мир…', '正在创建世界…', '世界を作成中…', 'Creando mundo…'],
  'Could not load the world.': ['Не удалось загрузить мир.', '无法加载世界。', '世界を読み込めませんでした。', 'No se pudo cargar el mundo.'],
  'Could not create the world. Try again.': ['Не удалось создать мир. Попробуйте ещё раз.', '无法创建世界。请重试。', '世界を作成できませんでした。もう一度お試しください。', 'No se pudo crear el mundo. Inténtalo de nuevo.'],
  'Try again': ['Попробовать снова', '重试', 'もう一度試す', 'Reintentar'],
  'Wheel: zoom · Drag: pan': ['Колесо — масштаб · Перетаскивание — перемещение', '滚轮：缩放 · 拖动：平移', 'ホイール：拡大縮小 · ドラッグ：移動', 'Rueda: zoom · Arrastrar: mover'],
  'Napalm Airstrike': ['Напалмовый авиаудар', '凝固汽油弹空袭', 'ナパーム空爆', 'Ataque aéreo con napalm'],
  'Call a bomber to drop 15 napalm canisters. Burning fuel spreads along a narrow strip.': ['Вызовите самолёт для сброса 15 напалмовых бомб. Горящее топливо покрывает узкую полосу.', '召唤轰炸机投下15枚凝固汽油弹。燃烧的燃料沿狭窄地带铺开。', '爆撃機を呼び、15発のナパーム弾を投下します。燃料が細い帯状に広がって燃えます。', 'Llama a un bombardero para lanzar 15 bombas de napalm. El combustible arde en una franja estrecha.'],
  'Too many active airstrikes': ['Слишком много активных авиаударов', '正在进行的空袭过多', '進行中の空爆が多すぎます', 'Demasiados ataques aéreos activos'],
  'Hammer of Dawn': ['Молот рассвета', '黎明之锤', 'ドーン・ハンマー', 'Martillo del Alba'],
  'Tsar Bomba 100MT': ['Царь-бомба 100 Мт', '沙皇炸弹 1亿吨', 'ツァーリ・ボンバ 100メガトン', 'Bomba del Zar 100 MT'],
  'Hold the left mouse button to fire an orbital beam. Move the pointer to guide it; release to stop. Right-drag to pan.': ['Удерживайте ЛКМ, чтобы стрелять орбитальным лучом. Ведите курсор для наведения; отпустите кнопку, чтобы остановить луч. ПКМ — перемещение карты.', '按住鼠标左键发射轨道光束。移动指针引导光束，松开即可停止。按住右键拖动地图。', '左ボタンを押し続けると軌道ビームを照射します。カーソルで誘導し、ボタンを離すと停止します。右ドラッグでマップを移動。', 'Mantén pulsado el botón izquierdo para disparar un rayo orbital. Mueve el cursor para guiarlo; suelta el botón para detenerlo. Arrastra con el botón derecho para mover el mapa.'],
  'Drop a 100MT bomb. A huge blast leaves a crater, a mushroom cloud and lingering radioactive fallout. Coastal craters fill with water.': ['Сбросьте бомбу мощностью 100 Мт. Мощный взрыв оставляет кратер, ядерный гриб и радиоактивные осадки. Прибрежные кратеры заполняются водой.', '投下一枚1亿吨当量炸弹。巨大的爆炸留下弹坑、蘑菇云和持续的放射性沉降。沿岸弹坑会被水淹没。', '100メガトンの爆弾を投下。巨大な爆発がクレーターとキノコ雲を生み、放射性降下物が残ります。海岸のクレーターは水で満たされます。', 'Lanza una bomba de 100 MT. La enorme explosión deja un cráter, una nube de hongo y lluvia radiactiva persistente. Los cráteres costeros se llenan de agua.'],
  'Too many active superweapons': ['Слишком много активных мощных ударов', '正在进行的超级武器攻击过多', '発動中の超兵器が多すぎます', 'Demasiadas superarmas activas'],
  'Spring': ['Весна', '春季', '春', 'Primavera'],
  'Summer': ['Лето', '夏季', '夏', 'Verano'],
  'Autumn': ['Осень', '秋季', '秋', 'Otoño'],
  'Winter': ['Зима', '冬季', '冬', 'Invierno'],
  'Year {year}': ['Год {year}', '第 {year} 年', '{year}年目', 'Año {year}'],
  'Food reserves': ['Запасы еды', '食物储备', '食料備蓄', 'Reservas'],
  'Migration: {a} → {b} ({count})': ['Переселение: {a} → {b} ({count})', '迁移：{a} → {b}（{count}）', '移住：{a} → {b}（{count}人）', 'Migración: {a} → {b} ({count})'],
  'Pioneers leave {village} ({count})': ['Из {village} отправились первопроходцы ({count})', '拓荒者离开 {village}（{count}）', '{village}から開拓者が出発（{count}人）', 'Pioneros parten de {village} ({count})'],
  'Migrants arrived in {village} ({count})': ['В {village} прибыли переселенцы ({count})', '移民抵达 {village}（{count}）', '{village}に移住者が到着（{count}人）', 'Llegan migrantes a {village} ({count})'],
  'Migration from {village} was interrupted': ['Переселение из {village} прервано', '来自 {village} 的迁移中断', '{village}からの移住が中断されました', 'Se interrumpió la migración desde {village}'],
} as const satisfies Record<string, readonly [string, string, string, string]>;

type Message = keyof typeof messages;
type EnglishMessage = keyof typeof englishMessages;
type Values = Record<string, string | number>;
const englishSources = new Map<string, Message>((Object.keys(messages) as Message[]).map(source => [messages[source][0], source]));
const column = { en: 0, 'zh-CN': 1, ja: 2, es: 3 } as const;
const hasMessage = (source: string): source is Message => Object.hasOwn(messages, source);
const hasEnglishMessage = (source: string): source is EnglishMessage => Object.hasOwn(englishMessages, source);
const englishColumn = { ru: 0, 'zh-CN': 1, ja: 2, es: 3 } as const;
const template = (source: string, language: Language): string => {
  if (hasEnglishMessage(source)) return language === 'en' ? source : englishMessages[source][englishColumn[language]];
  return hasMessage(source) && language !== 'ru' ? messages[source][column[language]] : source;
};
const format = (source: string, values: Values): string => source.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
const escapePattern = (source: string): string => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = [...Object.keys(messages), ...Object.keys(englishMessages)].filter(source => source.includes('{')).map(source => {
  const keys: string[] = [];
  const pattern = source.split(/(\{\w+\})/g).map(part => {
    if (!part.startsWith('{')) return escapePattern(part);
    keys.push(part.slice(1, -1)); return '(.+?)';
  }).join('');
  return { source, keys, pattern: new RegExp(`^${pattern}$`, 'u'), specificity: source.replace(/\{\w+\}/g, '').length };
}).sort((a, b) => b.specificity - a.specificity);

/** Translate at the presentation boundary; saved worlds and their names stay language-independent. */
export function translate(source: string, language: Language, values: Values = {}): string {
  source = englishSources.get(source) ?? source;
  if (hasMessage(source) || hasEnglishMessage(source)) return format(template(source, language), values);
  for (const entry of patterns) {
    const match = source.match(entry.pattern);
    if (!match) continue;
    const captured = Object.fromEntries(entry.keys.map((key, i) => [key, key === 'reason' || key === 'error' ? translate(match[i + 1], language) : match[i + 1]]));
    return format(template(entry.source, language), captured);
  }
  return format(source, values);
}

export function loadLanguage(): Language {
  try { const value = localStorage.getItem(LANGUAGE_KEY); return isLanguage(value) ? value : DEFAULT_LANGUAGE; }
  catch { return DEFAULT_LANGUAGE; }
}
export function saveLanguage(language: Language): boolean {
  try { localStorage.setItem(LANGUAGE_KEY, language); return true; }
  catch { return false; }
}
