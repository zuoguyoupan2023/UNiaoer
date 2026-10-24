/**
 * 081 §6.1 / 082 §2、§7（2026-10-24）：「历史/旧称/异语/异级名称 → ISO 3166-2 现行一级区划」映射表。
 *
 * ## 为什么需要
 * 有些国家 ISO 的一级区划与 GBIF `stateProvince` 写的**不同级或不同名**：
 *  - PH 菲律宾：ISO 一级是 **17 个大区**，GBIF 写的是 **81 个省**（异级）；
 *  - NP 尼泊尔：数据集曾是 2015 年前的 5 个发展大区，GBIF 用 **2015 年后的 7 个省**（数据集用
 *    `fetch-subdivisions.mjs` 的 DATASET_OVERRIDES 修正）；
 *  - LK 斯里兰卡：ISO 一级是 **9 个省**，GBIF 写 **25 个县**（异级）；
 *  - SE 瑞典：GBIF 大量写**历史地理省（landskap）**，ISO 是 21 个现代县（异级/历史）；
 *  - NO 挪威：数据集曾是 2020 合并前旧县，**现行 ISO 是 2020 合并后的 11 县**（数据集已用
 *    DATASET_OVERRIDES 修正，用户 2026-10-24 拍板「用现行 ISO」）；GBIF 新旧县名并存，旧县
 *    都是**整县并入单一新县**（N:1），全部可安全归并；
 *  - FI 芬兰：数据集用英文区名，GBIF 大量写**芬兰语区名**（同区异语）。
 * 只收「该名称**完整落在恰好一个一级区划内**」的关系，1:N 的一律**不映射**（宁缺勿错，同
 * NAME_ALIASES 里 "Manchuria" 的先例），被拒的高频名在各节注释里显式列出。
 *
 * ## 使用方式
 * `matchSubdivision` 在「别名 → ISO 直接命中」都失败后，按 key 查 `PROVINCE_TO_L1[国家]`。
 * key 一律是 `canonName()` 结果；value 必须是该区划数据集里存在的 code（`buildIndex` 会校验，
 * 数据集过时/拼错会在构建时硬失败）。
 *
 * ## 消歧原则（都写进条目注释）
 *  - 裸岛名若横跨多区不映射（Luzon / Mindanao / Negros / Lappland）；岛=单省或岛群全在同一大区才收
 *    （Panay 4 省同属 PH-06、Samar 3 省同属 PH-08、Sibuyan 属 Romblon→PH-41）；
 *  - 城市名只在「同省同名会撞」时作为**保护键**收（Quezon City→PH-00 必须先于 Quezon→PH-40 命中）；
 *  - 国名当省名不映射（LK 的 "Sri Lanka"，同 SG 新加坡先例）；拼写存疑不映射（LK 裸 "Nuwara"）；
 *  - 旧大区/旧省跨 ≥2 现行区的不映射（NP 发展大区、FI 旧 lääni、SE 的 Uppland 等）；
 *  - SE「字母, landskap」组合：字母=县字母码且与 landskap 归属**一致**才收
 *    （"H, Öland"→H=Kalmar ✓；"B, Södermanland"→B≠D 不一致，不收）。
 */

export const PROVINCE_TO_L1 = {
  // ── PH：省 → 大区（ISO 3166-2:PH 一级 = 17 个 Region）────────────────
  PH: {
    // Ilocos（PH-01）
    'ilocos norte': 'PH-01', 'ilocos sur': 'PH-01', 'la union': 'PH-01', pangasinan: 'PH-01',
    // Cagayan Valley（PH-02）
    batanes: 'PH-02', cagayan: 'PH-02', isabela: 'PH-02', 'nueva vizcaya': 'PH-02', quirino: 'PH-02',
    // 岛/岛群属 Cagayan 省（Babuyan 与 Batanes 的 Batan 群岛）
    'babuyan islands': 'PH-02', 'babuyan is': 'PH-02', calayan: 'PH-02',
    'batan island': 'PH-02', 'batan islands': 'PH-02', 'batan is': 'PH-02', fuga: 'PH-02', 'fuga island': 'PH-02',
    // Central Luzon（PH-03）
    bataan: 'PH-03', bulacan: 'PH-03', 'nueva ecija': 'PH-03', pampanga: 'PH-03', tarlac: 'PH-03',
    zambales: 'PH-03', aurora: 'PH-03',
    // CALABARZON（PH-40）
    batangas: 'PH-40', cavite: 'PH-40', laguna: 'PH-40', quezon: 'PH-40', rizal: 'PH-40',
    laguma: 'PH-40', // 拼写变体
    // Quezon 岛群（Polillo 群岛属 Quezon 省）；Tayabas=Quezon 省旧名
    polillo: 'PH-40', 'polillo is': 'PH-40', 'polillo island': 'PH-40', tayabas: 'PH-40',
    // MIMAROPA（PH-41）
    marinduque: 'PH-41', 'marinduque i': 'PH-41', 'occidental mindoro': 'PH-41',
    'oriental mindoro': 'PH-41', palawan: 'PH-41', romblon: 'PH-41',
    'occ mindoro': 'PH-41', 'mindoro occidental': 'PH-41', 'or mindoro': 'PH-41', 'mindoro oriental': 'PH-41',
    // Palawan 省 = Palawan 岛 + 属岛（Balabac/Calamian/Cuyo/Culion/Cagayancillo/Busuanga）
    'palawan island': 'PH-41', 'palawan is': 'PH-41', 'palawan id': 'PH-41', 'palawan i': 'PH-41',
    'ile palawan': 'PH-41', 'ile palawan palawan': 'PH-41',
    balabac: 'PH-41', 'balabac island': 'PH-41', 'calamian island group': 'PH-41',
    calamianes: 'PH-41', 'calamianes is': 'PH-41', 'calamian is': 'PH-41',
    culion: 'PH-41', 'culion island': 'PH-41', cagayancillo: 'PH-41',
    cuyo: 'PH-41', 'cuyo islands': 'PH-41', 'busuanga island': 'PH-41',
    // Romblon 省属岛（Sibuyan/Tablas/Banton）；Lubang 属 Occidental Mindoro；Narra 是 Palawan 自治市
    sibuyan: 'PH-41', 'sibuyan is': 'PH-41', tablas: 'PH-41', banton: 'PH-41',
    lubang: 'PH-41', narra: 'PH-41',
    // Bicol（PH-05）
    albay: 'PH-05', 'camarines norte': 'PH-05', 'camarines sur': 'PH-05', catanduanes: 'PH-05',
    masbate: 'PH-05', sorsogon: 'PH-05',
    'caramines sur': 'PH-05', camarines: 'PH-05', sorsogo: 'PH-05',
    // Ticao 岛属 Masbate 省
    ticao: 'PH-05',
    // Western Visayas（PH-06）
    aklan: 'PH-06', antique: 'PH-06', capiz: 'PH-06', guimaras: 'PH-06', iloilo: 'PH-06',
    'negros occidental': 'PH-06',
    // Panay 岛 4 省全在 PH-06 → 岛名可安全归大区
    panay: 'PH-06', 'panay island': 'PH-06', 'panay i': 'PH-06', 'panay is': 'PH-06',
    'guimaras i': 'PH-06', 'guimaras island': 'PH-06',
    // Central Visayas（PH-07）
    bohol: 'PH-07', cebu: 'PH-07', 'negros oriental': 'PH-07', siquijor: 'PH-07',
    'bohol island': 'PH-07', 'cebu island': 'PH-07', 'siquijor island': 'PH-07',
    'neg or': 'PH-07', bojol: 'PH-07', bogol: 'PH-07',
    // Eastern Visayas（PH-08）
    biliran: 'PH-08', 'eastern samar': 'PH-08', leyte: 'PH-08', 'northern samar': 'PH-08',
    samar: 'PH-08', 'southern leyte': 'PH-08',
    // Samar 岛 3 省全在 PH-08；Western/Samar Oriental 为旧/变体名
    'samar island': 'PH-08', 'samar i': 'PH-08', 'samar is': 'PH-08', 'samar id': 'PH-08',
    'western samar': 'PH-08', 'samar oriental': 'PH-08', 'homonhon id': 'PH-08',
    leite: 'PH-08', 'leite i': 'PH-08',
    // Zamboanga Peninsula（PH-09）
    'zamboanga del norte': 'PH-09', 'zamboanga del sur': 'PH-09', 'zamboanga sibugay': 'PH-09',
    'zamboango del norte': 'PH-09', 'zamboanga city': 'PH-09', 'zamboanga pen': 'PH-09',
    // Northern Mindanao（PH-10）
    bukidnon: 'PH-10', camiguin: 'PH-10', 'lanao del norte': 'PH-10', 'misamis occidental': 'PH-10',
    'misamis oriental': 'PH-10',
    'camiguin sur': 'PH-10', 'camiguin id': 'PH-10', 'camiguin sur island': 'PH-10',
    // Davao（PH-11）；Compostela Valley = Davao de Oro 旧名（2019 改名）
    'davao de oro': 'PH-11', 'compostela valley': 'PH-11', 'davao del norte': 'PH-11',
    'davao del sur': 'PH-11', 'davao occidental': 'PH-11', 'davao oriental': 'PH-11',
    // Soccsksargen（PH-12）
    cotabato: 'PH-12', 'north cotabato': 'PH-12', sarangani: 'PH-12', 'south cotabato': 'PH-12',
    'sultan kudarat': 'PH-12',
    // Caraga（PH-13）
    'agusan del norte': 'PH-13', 'agusan del sur': 'PH-13', 'surigao del norte': 'PH-13',
    'surigao del sur': 'PH-13',
    dinagat: 'PH-13', 'dinagat islands': 'PH-13', 'dinagat is': 'PH-13',
    // BARMM（PH-14；数据集显示名仍是旧称 Autonomous Region in Muslim Mindanao）
    basilan: 'PH-14', 'lanao del sur': 'PH-14', maguindanao: 'PH-14', sulu: 'PH-14',
    'tawi tawi': 'PH-14',
    bangsamoro: 'PH-14', 'bangsamoro autonomous region in muslim mindanao': 'PH-14',
    'basilan i': 'PH-14', 'sulu i': 'PH-14', 'tawi tawi island': 'PH-14', 'tawi tawi i': 'PH-14',
    'tawi tawi group': 'PH-14', 'sanga sanga': 'PH-14',
    // Cagayan Sulu = Mapun（Tawi-Tawi 省属岛），**不是** Cagayan 省
    'cagayan sulu islands': 'PH-14',
    // Cordillera（PH-15）；Kalinga-Apayao 为旧合并省（两省同属 PH-15 → 区级可映射）
    abra: 'PH-15', apayao: 'PH-15', benguet: 'PH-15', ifugao: 'PH-15', kalinga: 'PH-15',
    'mountain province': 'PH-15',
    'kalinga apayao': 'PH-15', cordillera: 'PH-15', banguet: 'PH-15',
    // NCR（PH-00）；Quezon City 保护键必须先于 Quezon→PH-40 命中
    'quezon city': 'PH-00', 'metro manila': 'PH-00', 'metropolitan manila': 'PH-00',
    'gran manila': 'PH-00', 'capital region': 'PH-00', manila: 'PH-00', 'manila city': 'PH-00',
    // Isabela City（Basilan）保护键，先于 Isabela→PH-02
    'isabela city': 'PH-14',
  },

  // ── NP：2015 后的 7 省 + 旧专区/县（数据集已用 DATASET_OVERRIDES 修正为 NP-P1..P7）──
  NP: {
    // 省名与官方临时编号（宪法顺序；P1 已改名 Koshi）
    'province 1': 'NP-P1', 'province no 1': 'NP-P1', kosi: 'NP-P1', mechi: 'NP-P1', // Mechi 专区 4 县全在 P1
    'province 2': 'NP-P2', 'province no 2': 'NP-P2', mahotari: 'NP-P2', mahotri: 'NP-P2',
    mahotra: 'NP-P2', bara: 'NP-P2', saptari: 'NP-P2', birganj: 'NP-P2', birgany: 'NP-P2', // Birganj=Parsa 县城
    'province 3': 'NP-P3', 'province no 3': 'NP-P3', 'bagmati pradesh': 'NP-P3',
    'bagmati province': 'NP-P3', 'bagmati zone': 'NP-P3', // Bagmati 专区 8 县全在 P3
    'kathmandu valley': 'NP-P3', kathmandu: 'NP-P3', newakot: 'NP-P3', nawakot: 'NP-P3',
    makawanpur: 'NP-P3', chitwan: 'NP-P3', rasuwa: 'NP-P3',
    'province 4': 'NP-P4', 'province no 4': 'NP-P4', 'gandaki pradesh': 'NP-P4',
    'gandaki province': 'NP-P4', dhaualagiri: 'NP-P4', dhaulagiri: 'NP-P4', // Dhaulagiri 专区 3 县全在 P4
    baglung: 'NP-P4', myagdi: 'NP-P4', 'myagdi dist': 'NP-P4', parbat: 'NP-P4', 'parbat dist': 'NP-P4',
    kusma: 'NP-P4', kaski: 'NP-P4', 'kaski dist': 'NP-P4', mustang: 'NP-P4', pokhara: 'NP-P4',
    'province 5': 'NP-P5', 'province no 5': 'NP-P5', palpa: 'NP-P5', banke: 'NP-P5',
    bardia: 'NP-P5', butwal: 'NP-P5', // Butwal=Rupandehi 县城
    'province 6': 'NP-P6', 'province no 6': 'NP-P6', 'karnali pradesh': 'NP-P6',
    jumla: 'NP-P6', mugu: 'NP-P6', dolpo: 'NP-P6', // Dolpo=Dolpa 县
    'province 7': 'NP-P7', 'province no 7': 'NP-P7', sudurpaschim: 'NP-P7', // GBIF 拼写少一个 h
    'sudurpashchim pradesh': 'NP-P7', 'sudur pashchimanchal': 'NP-P7', // 旧大区名，1:1 对应现行 P7
    'far western': 'NP-P7', kailali: 'NP-P7', kanchanpur: 'NP-P7', doti: 'NP-P7',
    bajhang: 'NP-P7', dandeldhura: 'NP-P7', dandaldhura: 'NP-P7', seti: 'NP-P7', // Seti 专区 5 县全在 P7
    mahakali: 'NP-P7', // Mahakali 专区 4 县全在 P7
    // Koshi 省各县（Koshi 本名走数据集 byKey）
    sankhuwasabha: 'NP-P1', 'sankhuwasabha dist': 'NP-P1', okhaldhunga: 'NP-P1', ilam: 'NP-P1',
    jhapa: 'NP-P1', morang: 'NP-P1',
    // 其它县（按所属省）。注意 Rukum / Nawalparasi 是跨省拆分县（东部属 P5 / 西部属 P6）→ 不映射
    bhojpur: 'NP-P1', dhankuta: 'NP-P1', terhathum: 'NP-P1', solukhumbu: 'NP-P1',
    khotang: 'NP-P1', udayapur: 'NP-P1', sunsari: 'NP-P1',
    dhading: 'NP-P3', lalitpur: 'NP-P3', bhaktapur: 'NP-P3', sindhupalchok: 'NP-P3',
    kavrepalanchok: 'NP-P3', sindhuli: 'NP-P3', ramechhap: 'NP-P3', dolakha: 'NP-P3',
    gorkha: 'NP-P4', syangja: 'NP-P4', tanahun: 'NP-P4', lamjung: 'NP-P4', manang: 'NP-P4',
    kapilvastu: 'NP-P5', rupandehi: 'NP-P5', arghakhanchi: 'NP-P5',
    gulmi: 'NP-P5', dang: 'NP-P5', pyuthan: 'NP-P5', rolpa: 'NP-P5',
    surkhet: 'NP-P6', dailekh: 'NP-P6', jajarkot: 'NP-P6', kalikot: 'NP-P6',
    humla: 'NP-P6', dolpa: 'NP-P6', achham: 'NP-P7', bajura: 'NP-P7', kailala: 'NP-P7',
    baitadi: 'NP-P7', dadeldhura: 'NP-P7', darchula: 'NP-P7',
    parsa: 'NP-P2', rautahat: 'NP-P2', sarlahi: 'NP-P2', dhanusha: 'NP-P2',
  },

  // ── LK：县 → 省（ISO 316-2:LK 一级 = 9 个 Province；"X Province" 本身可直配）────
  LK: {
    // Western（LK-1）
    colombo: 'LK-1', gampaha: 'LK-1', kalutara: 'LK-1',
    // Central（LK-2）
    kandy: 'LK-2', matale: 'LK-2', 'nuwara eliya': 'LK-2',
    // Southern（LK-3）
    galle: 'LK-3', matara: 'LK-3', hambantota: 'LK-3',
    // Northern（LK-4）
    jaffna: 'LK-4', kilinochchi: 'LK-4', mannar: 'LK-4', mullaittivu: 'LK-4', mullaitivu: 'LK-4',
    vavuniya: 'LK-4', 'uturu palata': 'LK-4', // Sinhala「Uturu paḷāta」= Northern Province
    // Eastern（LK-5）
    ampara: 'LK-5', amparai: 'LK-5', batticaloa: 'LK-5', trincomalee: 'LK-5',
    // North Western（LK-6）
    kurunegala: 'LK-6', puttalam: 'LK-6',
    // North Central（LK-7）
    anuradhapura: 'LK-7', polonnaruwa: 'LK-7',
    // Uva（LK-8）
    badulla: 'LK-8', monaragala: 'LK-8', moneragala: 'LK-8', 'uva palata': 'LK-8',
    // Sabaragamuwa（LK-9）
    kegalle: 'LK-9', kegalla: 'LK-9', ratnapura: 'LK-9', 'sabaragamuwa palata': 'LK-9',
    // 不映射（宁缺勿错）：裸 "Nuwara"（Sinhala=城市，可能指 Nuwara Eliya 或 Kandy/Maha Nuwara）、
    // "Sri Lanka"/"Ceylon"（国名当省名，同 SG 先例）、"North Eastern Province"（1988–2006 旧省，
    // 横跨 Northern+Eastern）。
  },

  // ── SE：历史地理省（landskap）→ 现代县（län）；只收 N:1/≈1:1，1:N 的显式列出（082 §7）──
  SE: {
    // ≈1:1（省界≈县界）
    skane: 'SE-M', gotland: 'SE-I', jamtland: 'SE-Z', harjedalen: 'SE-Z', // Härjedalen ⊂ Jämtlands län
    // N:1（整省落在单一县内）
    oland: 'SE-H', // Öland 岛全境属 Kalmar län
    bohuslan: 'SE-O', dalsland: 'SE-O', // 两省全在 Västra Götaland
    gastrikland: 'SE-X', medelpad: 'SE-Y',
    // 县名/市名（GBIF 直书现代县或县城，走省码）
    stockholm: 'SE-AB', 'stockholm county': 'SE-AB', kalmar: 'SE-H', uppsala: 'SE-C',
    'uppsala county': 'SE-C', gavleborg: 'SE-X', 'vastra gotaland': 'SE-O',
    // 拼写/简写变体（"V. Götalands län" 缺 ä；BD/AC 为县字母码）
    'v gotalands lan': 'SE-O', 'bd lan': 'SE-BD', 'ac lan': 'SE-AC',
    // 历史 lappmark（萨米管区，1810 年后各属一县）
    'lycksele lappmark': 'SE-AC', 'asele lappmark': 'SE-AC', // → Västerbotten
    'torne lappmark': 'SE-BD', 'lule lappmark': 'SE-BD', 'pite lappmark': 'SE-BD', // → Norrbotten
    // 「字母, landskap」组合：字母=县字母码且与 landskap 归属一致才收（数据为标本馆口径）。
    // 不一致的不收：'b sodermanland'/'b uppland'（B≠D/C）、't varmland'/'t vastmanland'（T≠S/U）、'e smaland'（存疑）。
    'h oland': 'SE-H', 'n halland': 'SE-N', 'i gotland': 'SE-I', 's varmland': 'SE-S',
    't narke': 'SE-T', 'k blekinge': 'SE-K', 'd sodermanland': 'SE-D', 'e ostergotland': 'SE-E',
    'x gastrikland': 'SE-X', 'x halsingland': 'SE-X', // Hälsingland 主体在 Gävleborg（X），组合已自证
    'g smaland': 'SE-G', 'h smaland': 'SE-H', 'f smaland': 'SE-F', // Småland 跨 F/G/H，字母消歧
    'c uppland': 'SE-C', 'u vastmanland': 'SE-U', 'z jamtland': 'SE-Z', 'w dalarna': 'SE-W',
    'y medelpad': 'SE-Y', 'y angermanland': 'SE-Y',
    // 不映射（1:N，占 SE 未映射大头，宁缺勿错）：Uppland（11.8M，跨 Uppsala/Stockholm/Västmanland）、
    // Västergötland（9.0M）、Småland（7.1M，跨 F/G/H）、Närke 裸名（2.1M）、Ångermanland（1.2M）、
    // Hälsingland 裸名（0.9M）、Västmanland 裸名（2.6M）、Lappland（跨 AC/BD）、Norrland/Svealand/Götaland。
  },

  // ── NO：2020 合并前旧县 → 现行 ISO 合并县（数据集已换现行 11 县；旧县整县并入 → 全部 N:1）──
  // 用户 2026-10-24 拍板「用现行 ISO」：显示名随 ISO（Viken 等在 2024 现实中已拆回，页面口径说明标注）。
  NO: {
    // → NO-30 Viken（Østfold + Akershus + Buskerud）
    ostfold: 'NO-30', akershus: 'NO-30', buskerud: 'NO-30', astfold: 'NO-30', // astfold = mojibake "Ãstfold"（17.5K）
    // → NO-34 Innlandet（Hedmark + Oppland）
    hedmark: 'NO-34', oppland: 'NO-34',
    // → NO-38 Vestfold og Telemark
    vestfold: 'NO-38', telemark: 'NO-38',
    // → NO-42 Agder（Vest- + Aust-Agder）
    'vest agder': 'NO-42', 'aust agder': 'NO-42',
    // → NO-46 Vestland（Hordaland + Sogn og Fjordane）
    hordaland: 'NO-46', 'sogn og fjordane': 'NO-46',
    // → NO-50 Trøndelag（Sør- + Nord-Trøndelag）
    'sor trondelag': 'NO-50', 'nord trondelag': 'NO-50',
    'sor trondelag fylke': 'NO-50', 'nord trondelag fylke': 'NO-50', // GBIF "… Fylke" 变体
    // → NO-54 Troms og Finnmark
    troms: 'NO-54', 'troms romsa': 'NO-54', finnmark: 'NO-54', finmark: 'NO-54',
    'finnmark finnmarku': 'NO-54', 'troms og finnmark fylke': 'NO-54', 'finnmark fylke': 'NO-54',
    // 旧数据集拼写（Finnmark / Finnmárku、Troms / Romsa）
    // 其它
    spitsbergen: 'NO-21', // Spitsbergen 是 Svalbard 主岛
    'nordland fylke': 'NO-18',
    // 不映射：海域（Norskekysten hav *）、市镇名（Bergen/Trysil/Voss…GBIF 混入一级字段）、
    // 碎片段（Nord/Sør/Aust）、municipality 白名单另做。
  },

  // ── FI：芬兰语/瑞典语区名 → 现行 19 区（数据集是英文名；同区异语 1:1，全部可安全归一）──
  FI: {
    // 芬兰语 → 数据集英文名（一一对应现行区划）
    'varsinais suomi': 'FI-19', 'south western finland': 'FI-19', // Southwest Finland 变体
    'pohjois pohjanmaa': 'FI-14', 'north ostrobothnia': 'FI-14',
    lappi: 'FI-10', lappland: 'FI-10', laponia: 'FI-10', 'finska lappland': 'FI-10', // Lapland 异语
    'kanta hame': 'FI-06', // Tavastia Proper（裸 "Häme"/"Tavastia" 跨 4+ 区不收）
    'pohjois karjala': 'FI-13',
    'pohjois savo': 'FI-15',
    pohjanmaa: 'FI-12', osterbotten: 'FI-12', // Ostrobothnia（裸键与含前缀键互不冲突）
    'etela pohjanmaa': 'FI-03',
    'paijat hame': 'FI-16', // Päijänne Tavastia
    'keski suomi': 'FI-08',
    'etela karjala': 'FI-02',
    'keski pohjanmaa': 'FI-07',
    'etela savo': 'FI-04',
    ahvenanmaa: 'FI-01', // = Åland
    // 拼写变体/瑞典语旧称
    uuisimaa: 'FI-18', uusima: 'FI-18', nyland: 'FI-18', // = Uusimaa
    // 不映射（1:N 旧 lääni，留国家层）：Vaasa、TURKU-PORI、Häme、Kymi、Oulu、Kuopio、Mikkeli、
    // Southern/Western/Eastern Finland（1997–2010 大区划）、AVI 管理区（Regional State Administrative
    // Agency for *，另一套 5 大区划）、两字母旧省码（Eh/Es/Ep…语义不定）。
  },
}
