import { PHYSIOLOGY } from './subspecies-traits';

// All names share the normal i18n path. Identifiers never appear in the inspector.
const names = `minimal-population|Минимальная популяция|最小种群|最小個体群|Población mínima
small-population|Малая популяция|小种群|小個体群|Población pequeña
moderate-population|Средняя популяция|中等种群|中個体群|Población moderada
large-population|Большая популяция|大种群|大個体群|Población grande
expansive-population|Огромная популяция|庞大种群|巨大個体群|Población extensa
sapience|Префронтальная кора|前额叶|前頭前野|Corteza prefrontal
advanced-hippocampus|Развитый гиппокамп|发达海马体|発達した海馬|Hipocampo avanzado
amygdala|Миндалевидное тело|杏仁核|扁桃体|Amígdala
wernickes-area|Зона Вернике|韦尼克区|ウェルニッケ野|Área de Wernicke
cautious-instincts|Осторожность|谨慎本能|慎重な本能|Instintos cautelosos
inquisitive-nature|Любознательность|好奇心|好奇心|Curiosidad
dreamweavers|Ткачи снов|织梦者|夢を紡ぐ者|Tejedores de sueños
fast-builders|Быстрые строители|快速建造|素早い建築|Constructores rápidos
slow-builders|Медленные строители|缓慢建造|遅い建築|Constructores lentos
hyper-intelligence|Высокий интеллект|超高智力|高い知能|Inteligencia superior
genetic-psychosis|Генетический психоз|遗传性精神病|遺伝性精神病|Psicosis genética
pure|Чистота|纯净|純粋|Pureza
super-positivity|Жизнерадостность|积极乐观|楽天的|Gran optimismo
telepathic-link|Телепатическая связь|心灵感应|テレパシー|Vínculo telepático
stomach|Желудок|胃|胃|Estómago
big-stomach|Большой желудок|大胃|大きな胃|Estómago grande
voracious|Прожорливость|贪食|大食い|Voracidad
accelerated-healing|Ускоренное исцеление|快速愈合|高速治癒|Curación acelerada
bad-genes|Плохие гены|不良基因|悪い遺伝子|Genes defectuosos
aquatic|Водная жизнь|水生|水生|Vida acuática
fins|Плавники|鳍|ひれ|Aletas
hovering|Парение|悬浮|浮遊|Levitación
unmoving|Неподвижность|无法移动|不動|Inmovilidad
cold-resistance|Устойчивость к холоду|耐寒|耐寒性|Resistencia al frío
heat-resistance|Устойчивость к жаре|耐热|耐熱性|Resistencia al calor
exoskeleton|Экзоскелет|外骨骼|外骨格|Exoesqueleto
bioluminescence|Биолюминесценция|生物发光|生物発光|Bioluminiscencia
enhanced-strength|Повышенная сила|增强力量|強化された力|Fuerza aumentada
good-throwers|Меткость броска|投掷能手|投擲上手|Buenos lanzadores
high-fecundity|Высокая плодовитость|高繁殖力|高い繁殖力|Alta fecundidad
long-lifespan|Долголетие|长寿|長寿|Longevidad
hydrophobia|Боязнь воды|怕水|水恐怖症|Hidrofobia
pollinator|Опылитель|传粉者|送粉者|Polinizador
omnivore|Всеядность|杂食|雑食|Omnívoro
herbivore|Травоядность|草食|草食|Herbívoro
carnivore|Мясоедение|肉食|肉食|Carnívoro
cannibalism|Каннибализм|同类相食|共食い|Canibalismo
algivore|Питание водорослями|食藻|藻食|Algívoro
florivore|Питание цветами|食花|花食|Florívoro
folivore|Питание листьями|食叶|葉食|Folívoro
frugivore|Питание плодами|食果|果実食|Frugívoro
geophagy|Питание почвой|食土|土食|Geofagia
graminivore|Питание травой|食草|牧草食|Graminívoro
granivore|Питание зерном|食谷|穀食|Granívoro
hematophagy|Питание кровью|吸血|吸血|Hematofagia
insectivore|Питание насекомыми|食虫|昆虫食|Insectívoro
lithotroph|Питание минералами|食矿|鉱物食|Litótrofo
nectarivore|Питание нектаром|食蜜|蜜食|Nectarívoro
piscivore|Питание рыбой|食鱼|魚食|Piscívoro
xylophagy|Питание древесиной|食木|木食|Xilofagia
photosynthetic-skin|Фотосинтезирующая кожа|光合皮肤|光合成する皮膚|Piel fotosintética
fenix-born|Возрождение|重生|再生|Renacimiento
butterfly-metamorphosis|Превращение в бабочку|化蝶|蝶への変身|Metamorfosis de mariposa
chicken-metamorphosis|Превращение в курицу|化鸡|鶏への変身|Metamorfosis de gallina
crab-metamorphosis|Превращение в краба|化蟹|蟹への変身|Metamorfosis de cangrejo
sword-metamorphosis|Превращение в меч|化剑|剣への変身|Metamorfosis de espada
wolf-metamorphosis|Превращение в волка|化狼|狼への変身|Metamorfosis de lobo
fire-elemental-form|Огненная форма|火元素形态|火の精霊形態|Forma de fuego
mythril-form|Мифриловая форма|秘银形态|ミスリル形態|Forma de mitril
plant-growth|Рост растения|植物生长|植物の成長|Crecimiento vegetal
tree-growth|Рост дерева|树木生长|樹木の成長|Crecimiento de árbol
gaia-roots|Корни Геи|盖亚之根|ガイアの根|Raíces de Gaia
parental-care|Родительская забота|亲代照顾|子育て|Cuidado parental
rapid-aging|Быстрое старение|快速衰老|急速な老化|Envejecimiento rápido
gem-production|Производство самоцветов|产宝石|宝石生成|Producción de gemas
gold-production|Производство золота|产金|金生成|Producción de oro
stone-production|Производство камня|产石|石生成|Producción de piedra
mushroom-production|Производство грибов|产蘑菇|キノコ生成|Producción de hongos
aggressive|Агрессивность|好斗|攻撃的|Agresividad
annoying-fireworks|Посмертный фейерверк|身后烟花|死後の花火|Fuegos artificiales póstumos
antimatter-essence|Антиматерия|反物质|反物質|Antimateria
genetic-mirror|Генетическое зеркало|遗传镜像|遺伝子の鏡|Espejo genético
unstable-genome|Нестабильный геном|不稳定基因组|不安定なゲノム|Genoma inestable
nimble|Ловкость|灵巧|器用|Agilidad
shiny-love|Тяга к богатству|爱财|富への欲望|Amor al dinero
spicy-kids|Огненные дети|火焰幼崽|火の子|Crías ardientes
gift-of-air|Дар воздуха|风之赐|風の贈り物|Don del aire
gift-of-blood|Дар крови|血之赐|血の贈り物|Don de sangre
gift-of-death|Дар смерти|死之赐|死の贈り物|Don de muerte
gift-of-fire|Дар огня|火之赐|火の贈り物|Don del fuego
gift-of-harmony|Дар гармонии|和谐之赐|調和の贈り物|Don de armonía
gift-of-life|Дар жизни|生之赐|命の贈り物|Don de vida
gift-of-thunder|Дар грома|雷之赐|雷の贈り物|Don del trueno
gift-of-the-void|Дар пустоты|虚空之赐|虚空の贈り物|Don del vacío
gift-of-water|Дар воды|水之赐|水の贈り物|Don del agua
energy-preserver|Сбережение энергии|节能|省エネルギー|Ahorro de energía
polyphasic-sleep|Многофазный сон|多相睡眠|多相睡眠|Sueño polifásico
monophasic-sleep|Однофазный сон|单相睡眠|単相睡眠|Sueño monofásico
prolonged-rest|Долгий отдых|长时间休息|長い休息|Descanso prolongado
nocturnal-dormancy|Ночная спячка|夜间休眠|夜の休眠|Letargo nocturno
circadian-drift|Сдвиг суточного ритма|昼夜节律漂移|概日リズム変動|Deriva circadiana
winter-slumberers|Зимняя спячка|冬眠|冬眠|Hibernación
chaos-driven|Ритм хаоса|混沌节律|混沌のリズム|Ritmo del caos
oviparity|Яйцекладность|卵生|卵生|Oviparidad
viviparity|Живорождение|胎生|胎生|Viviparidad
sexual|Половое размножение|有性繁殖|有性生殖|Reproducción sexual
hermaphroditic|Гермафродитизм|雌雄同体|雌雄同体|Hermafroditismo
parthenogenesis|Партеногенез|孤雌生殖|単為生殖|Partenogénesis
budding|Почкование|出芽|出芽|Gemación
fission|Деление|分裂|分裂|Fisión
spore|Размножение спорами|孢子繁殖|胞子生殖|Esporas
vegetative|Вегетативное размножение|营养繁殖|栄養生殖|Reproducción vegetativa
divine|Божественное рождение|神圣繁殖|神聖な生殖|Nacimiento divino
soulborne|Рождение из души|灵魂繁殖|魂からの誕生|Nacimiento del alma
metamorph|Размножение превращением|变形繁殖|変身生殖|Reproducción metamórfica
short-gestation|Короткое вынашивание|短孕期|短い妊娠|Gestación corta
moderate-gestation|Среднее вынашивание|中等孕期|中程度の妊娠|Gestación moderada
long-gestation|Долгое вынашивание|长孕期|長い妊娠|Gestación larga
very-long-gestation|Очень долгое вынашивание|很长孕期|非常に長い妊娠|Gestación muy larga
extremely-long-gestation|Крайне долгое вынашивание|极长孕期|極めて長い妊娠|Gestación extremadamente larga
alien-egg|Инопланетное яйцо|外星卵|異星の卵|Huevo alienígena
blob-egg|Слизистое яйцо|黏液卵|粘液の卵|Huevo gelatinoso
bubble-egg|Яйцо-пузырь|气泡卵|泡の卵|Huevo burbuja
candy-egg|Конфетное яйцо|糖果卵|飴の卵|Huevo de caramelo
cocoon-egg|Кокон|茧|繭|Capullo
colored-egg|Цветное яйцо|彩色卵|色付きの卵|Huevo de color
crystal-egg|Кристальное яйцо|水晶卵|水晶の卵|Huevo de cristal
eyeball-egg|Яйцо-глаз|眼球卵|目玉の卵|Huevo ocular
face-egg|Яйцо-лицо|面孔卵|顔の卵|Huevo con rostro
flames-egg|Огненное яйцо|火焰卵|炎の卵|Huevo llameante
ice-egg|Ледяное яйцо|冰卵|氷の卵|Huevo de hielo
metal-box-egg|Металлическое яйцо|金属卵|金属の卵|Huevo metálico
orb-egg|Яйцо-сфера|球形卵|球形の卵|Huevo esfera
pumpkin-egg|Яйцо-тыква|南瓜卵|カボチャの卵|Huevo calabaza
rainbow-egg|Радужное яйцо|彩虹卵|虹の卵|Huevo arcoíris
roe-egg|Икра|鱼卵|魚卵|Huevas
plain-shell-egg|Обычная скорлупа|普通卵壳|普通の殻|Cáscara lisa
spotted-shell-egg|Пятнистая скорлупа|斑点卵壳|斑点の殻|Cáscara moteada
light-orb|Световая сфера|光球|光の球|Esfera de luz
abomination|Чудовищная форма|畸变形态|異形|Abominación
blood-vortex|Кровавый вихрь|血涡|血の渦|Vórtice de sangre
burger-being|Существо-бургер|汉堡生物|バーガー生物|Ser hamburguesa
energy-being|Энергетическое существо|能量体|エネルギー体|Ser de energía
fractal|Фрактальная форма|分形|フラクタル|Fractal
living-rock|Живой камень|活石|生きた岩|Roca viva
orb|Сфера|球体|球体|Esfera
tentacle-horror|Щупальцевая форма|触手形态|触手の姿|Horror tentacular
void-form|Форма пустоты|虚空形态|虚空の姿|Forma del vacío
desert-adaptation|Адаптация к пустыне|沙漠适应|砂漠適応|Adaptación al desierto
corrupted-adaptation|Адаптация к порче|腐化适应|腐敗適応|Adaptación a la corrupción
infernal-adaptation|Адаптация к пеклу|地狱适应|地獄適応|Adaptación infernal
permafrost-adaptation|Адаптация к мерзлоте|冻土适应|永久凍土適応|Adaptación al permafrost
swamp-adaptation|Адаптация к болоту|沼泽适应|沼地適応|Adaptación al pantano
wasteland-adaptation|Адаптация к пустоши|荒地适应|荒地適応|Adaptación al páramo
grin-mark|Метка жнеца|收割者印记|死神の印|Marca del segador
gmo|ГМО|转基因|遺伝子改変|OMG
uplifted|Возвышенный|升格|昇格|Elevado
genealogy|Родословная|谱系|系譜|Genealogía
tools|Использование орудий|工具使用|道具の使用|Uso de herramientas
governance|Управление|治理|統治|Gobierno`;
export const physiologyMessages: Record<string, readonly [string, string, string, string]> = Object.fromEntries(names.split('\n').map(row => {
  const [id, ru, zh, ja, es] = row.split('|'); return [PHYSIOLOGY[id as keyof typeof PHYSIOLOGY].label, [ru, zh, ja, es]];
}));
Object.assign(physiologyMessages, {
  'Grin Reaper': ['Жнец отмеченных', '印记收割者', '印の死神', 'Segador de los marcados'],
  'Marked subspecies gradually lose members.': ['Отмеченные подвиды постепенно теряют особей.', '被标记的亚种逐渐失去成员。', '印を持つ亜種の個体が徐々に失われます。', 'Las subespecies marcadas pierden miembros gradualmente.'],
  'The required biome is not available': ['Нужный биом пока недоступен', '所需生物群系尚不可用', '必要なバイオームは未対応です', 'El bioma necesario aún no está disponible'],
  'Playing: jumping': ['Играет: прыжки', '玩耍：跳跃', '遊び：ジャンプ', 'Jugando a saltar'],
  'Playing: spinning': ['Играет: кружится', '玩耍：旋转', '遊び：回転', 'Jugando a girar'],
  'Playing: dancing': ['Играет: танцует', '玩耍：跳舞', '遊び：ダンス', 'Jugando a bailar'],
  'Diet': ['Рацион', '食谱', '食性', 'Dieta'],
  'Subspecies physiology': ['Физиология подвида', '亚种生理', '亜種の生理', 'Fisiología de la subespecie'],
  'Edit physiology': ['Изменить физиологию', '编辑生理', '生理を編集', 'Editar fisiología'],
  'Apply physiology': ['Применить физиологию', '应用生理', '生理を適用', 'Aplicar fisiología'],
  'Changes affect every living member and future offspring.': ['Изменения затронут всех живых носителей и будущее потомство.', '更改影响所有存活成员和未来后代。', '変更は生存する全個体と将来の子孫に適用されます。', 'Los cambios afectan a los miembros vivos y a su futura descendencia.'],
  'Add ability': ['Добавить признак', '添加特征', '特性を追加', 'Añadir rasgo'], 'Remove ability': ['Удалить признак', '移除特征', '特性を削除', 'Quitar rasgo'],
  'Requires': ['Требуется', '需要', '必要', 'Requiere'], 'Incompatible with': ['Несовместимо с', '不兼容', '非互換', 'Incompatible con'],
  'Pending changes': ['Изменения к применению', '待应用更改', '適用前の変更', 'Cambios pendientes'],
  'Enable forbidden knowledge to edit physiology': ['Включите запретные знания для изменения физиологии', '启用禁忌知识以编辑生理', '生理の編集には禁断の知識を有効にしてください', 'Activa el conocimiento prohibido para editar la fisiología'],
  'The subspecies changed; reopen the editor': ['Подвид изменился; откройте редактор заново', '亚种已更改，请重新打开编辑器', '亜種が変更されました。編集画面を開き直してください', 'La subespecie cambió; vuelve a abrir el editor'],
  'Resume time before applying physiology': ['Возобновите время перед применением физиологии', '请先恢复时间', '時間を再開してから適用してください', 'Reanuda el tiempo antes de aplicar'],
  'Physiology applied to the whole subspecies': ['Физиология применена ко всему подвиду', '已应用于整个亚种', '亜種全体に適用しました', 'Fisiología aplicada a toda la subespecie'],
  'Physiology could not be applied; no changes were made': ['Физиология не применена; изменений нет', '未能应用，未作更改', '適用できませんでした。変更はありません', 'No se aplicó la fisiología; sin cambios'],
  'Subspecies birth capacity': ['Мест для потомства подвида', '亚种后代名额', '亜種の出生枠', 'Capacidad de descendencia'],
  'No subspecies limit': ['Без лимита подвида', '无亚种上限', '亜種の上限なし', 'Sin límite de subespecie'],
  'Subspecies population limit': ['Достигнут предел подвида', '达到亚种上限', '亜種の個体数上限', 'Límite de población de la subespecie'],
  'Culture and language are not available': ['Культуры и языки пока недоступны', '文化和语言尚不可用', '文化と言語は未対応です', 'Cultura e idioma aún no disponibles'],
  'The required body is not available': ['Нужная форма существа пока недоступна', '所需形态尚不可用', '必要な姿は未対応です', 'La forma necesaria aún no está disponible'],
  'Mythril deposits are not available': ['Залежи мифрила пока недоступны', '秘银矿尚不可用', 'ミスリル鉱床は未対応です', 'Los depósitos de mitril aún no están disponibles'],
  'This body appearance is not available': ['Эта форма тела пока недоступна', '此外形尚不可用', 'この外見は未対応です', 'Esta apariencia aún no está disponible'],
  'This birth power is not available': ['Этот дар рождения пока недоступен', '此出生能力尚不可用', 'この誕生能力は未対応です', 'Este don de nacimiento aún no está disponible'],
  'This body cannot perform settlement duties': ['Это существо не может работать в поселении', '此生物无法执行城镇任务', 'この生物は集落の仕事ができません', 'Este cuerpo no puede trabajar en el asentamiento'],
  'This body has no feeding behavior': ['У этого существа нет пищевого поведения', '此生物没有进食行为', 'この生物には摂食行動がありません', 'Este cuerpo no tiene conducta alimentaria'],
  'Mushroom plants are not available': ['Грибные растения пока недоступны', '蘑菇植物尚不可用', 'キノコ植物は未対応です', 'Las plantas de hongos aún no están disponibles'],
  'Food consumed': ['Пища съедена', '已进食', '食事完了', 'Alimento consumido'], 'No sunlight': ['Нет солнечного света', '无阳光', '日光がありません', 'Sin luz solar'],
  'Nutrition from sunlight': ['Питание от солнечного света', '获得光合营养', '日光から栄養を獲得', 'Nutrición solar'],
  'Biological deposit created': ['Создана биологическая залежь', '生成生物矿藏', '生物由来の鉱床を生成', 'Depósito biológico creado'],
  'No room for a biological deposit': ['Нет места для биологической залежи', '没有生物矿藏空间', '鉱床を作る空間がありません', 'Sin espacio para un depósito biológico'],
  'No route to food': ['Нет пути к пище', '无进食路线', '食料への道がありません', 'Sin ruta al alimento'],
  'Hunting for food': ['Охота ради пищи', '狩猎取食', '食料のために狩猟中', 'Cazando alimento'],
  'Flower pollinated': ['Цветок опылён', '花朵已授粉', '花を受粉しました', 'Flor polinizada'],
  'Food source is unavailable': ['Источник пищи недоступен', '食物来源不可用', '食料源を利用できません', 'Fuente de alimento no disponible'],
  'Approaching food source': ['Идёт к источнику пищи', '前往食物来源', '食料源へ移動中', 'Acercándose al alimento'],
  'No reachable food source': ['Нет доступного источника пищи', '无可达食物来源', '到達できる食料源がありません', 'Sin fuente de alimento accesible'],
  'Honey delivered': ['Мёд доставлен', '蜂蜜已送达', '蜂蜜を配達しました', 'Miel entregada'],
});
