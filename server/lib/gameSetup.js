// lib/gameSetup.js
const crypto = require('crypto');

function setupGame(players, selection, fairness = {}) {
  const { lastImpostorId = null, lastImpostorStreak = 0 } = fairness;
  const DEBUG = true;
  const log = (...a) => { if (DEBUG) console.log('[setupGame]', ...a); };

  // ===== 1) Normaliza entrada (string u objeto)
  const normalize = (sel) => {
    if (typeof sel === 'string') {
      if (sel.startsWith('Fútbol::')) {
        return { category: 'Fútbol', subtopic: sel.split('::')[1] || '' };
      }
      return { category: sel };
    }
    return sel || { category: 'animales' };
  };

  const sel = normalize(selection);
  log('input selection:', selection);
  log('normalized sel:', sel);

  // ===== 2) Pools base
  const BASE = {
    animales: ["perro","gato","elefante","león","tigre","oso","conejo","pájaro","pez","caballo","serpiente","pato","cocodrilo","jirafa","cebra","hipopótamo","rinoceronte","mono","lobo","zorro","ciervo","ardilla","ratón","murciélago","delfín","ballena","foca","koala","canguro","panda","águila","búho","pingüino","flamenco","loro","cisne","gallina","gallo","pavo","tortuga","iguana","lagarto","camaleón","rana","sapo","salamandra","tiburón","pulpo","medusa","estrella de mar","cangrejo","abeja","mariposa","hormiga","araña","libélula","escarabajo"],
    películas: ['avatar','titanic','avengers','starwars','batman','superman','spiderman','frozen','shrek','harry potter','el señor de los anillos','jurassic park','jurassic world','el rey león','la bella y la bestia','los increíbles','buscando a nemo','coco','mi villano favorito','minions','madagascar','kung fu panda','cars','intensamente','moana','encanto','doctor strange','iron man','thor','black panther','toy story','Interstellar','Joker','Deadpool','Barbie','Forrest gump','Matrix','El lobo de wall street','Up','Ratatouille','Wall-e','Monsters inc','Aladdin','Piratas del caribe','Rápido y Furioso','Transformers','Maze runner','the silence of the lambs','the social network','a star is born','bohemian rhapsody','once upon a time in hollywood',"Guardianes de la Galaxia",'captain america','ant-man','black widow','john wick','mission: impossible','godzilla','breaking bad','game of thrones','stranger things','dark','the office','friends','black mirror','peaky blinders','narcos','la casa de papel','élite','vis a vis','chernobyl','lost','prison break','vikings',"grey's anatomy",'dragon ball z','el marginal','okupas','merlí'],
    cantantes: [
      "Bad Bunny","Daddy Yankee","Don Omar","Wisin","Yandel","Rauw Alejandro","Ozuna","Anuel AA","Tego Calderón","Residente","Luis Fonsi","Ricky Martin","Chayanne","Pedro Capó","Nicky Jam","Farruko","De La Ghetto","Ñengo Flow","Arcángel","Zion","Lennox","Plan b",
      "Lunay","Myke Towers","Mora","Lyanno","Bryant Myers","Alex Rose","Dalex","Jay Wheeler","Almighty","Cosculluela",
      "Jowell y Randy","Kendo Kaponi","Anonimus","Young Miko","Villano Antillano","YOVNGCHIMI","De la Rose",
      "TINI","María Becerra","Lali","Emilia Mernes","Nicki Nicole","Cazzu","Nathy Peluso","Soledad Pastorutti",
      "Abel Pintos","Luciano Pereyra","Sergio Denis","Axel","Diego Torres","Fito Páez","Charly García","Gustavo Cerati",
      "Luis Alberto Spinetta","Andrés Calamaro","Vicentico","Paulo Londra","Duki","Bizarrap","Trueno",
      "Tiago PZK","Khea","Lit Killah","Rusherking","Wos","La Joaqui","Milo J","Luck Ra","BM","FMK",
      "Callejero Fino","Emanero","Pablo Lescano","Rodrigo","La Mona Jiménez","Ulises Bueno",
      "Miranda","Soda Stereo","Patricio Rey y sus Redonditos de Ricota","Los Fabulosos Cadillacs","Divididos","Las Pelotas","La Renga",
      "Los Piojos","Babasónicos","Bersuit Vergarabat","Ratones Paranoicos","Enanitos Verdes","Attaque 77","2 Minutos","Rata Blanca",
      "Almafuerte","Pappo's Blues","Pescado Rabioso","Sui Generis","Serú Girán","Virus","Turf","Los Tipitos","Los Brujos",
      "Los Pericos","Los Auténticos Decadentes","Estelares","Guasones","Los Gardelitos","Viejas Locas","Intoxicados","Airbag",
      "Ciro y los Persas","La Beriso","Las Pastillas del Abuelo","Tan Biónica","El Mató a un Policía Motorizado",
      "Polimá Westcoast","Pablo Chill-E","Cris MJ","Canserbero",
      "Shakira","Karol G","Maluma","J Balvin","Feid","Sebastián Yatra","Camilo","Manuel Turizo",
      "Carlos Vives","Blessd","Ryan Castro","Beéle","Morat","Ricardo Montaner","Ovy on the Drums",
      "Luis Miguel","Cristian Castro","Peso Pluma","Natanael Cano","Reik ","Maná (Fher Olvera)","Sin Bandera (Noel Schajris)",
      "Romeo Santos","Prince Royce","Natti Natasha","Tokischa","El Alfa","Zion & Lennox",
      "Natalia Oreiro","Emiliano Brancciari (NTVG)","Sebastián Teysera (La Vela Puerca)",
      "Roberto Musso (El Cuarteto de Nos)","Agustín Casanova (Márama)","Fernando Vázquez (Rombai)","Franny Glass",
      "Ricardo Montaner","Chino & Nacho","Danny Ocean",
      "Rosalía","C. Tangana","Aitana","Quevedo","Lola Índigo","Rels B","Bad Gyal","David Bisbal","Alejandro Sanz","Beret",
      "Leiva","Enrique Iglesias","Julio Iglesias","Omar Montes",
      "Sech","Boza","Joey Montana",
      "Camila Cabello"
    ],
  };

  // ===== 3) Fútbol + aliases + "Jugadores (todos)"
  const FUTBOL = {
    "🌍 Jugadores actuales (mundo)": [
      'Vinícius Júnior','Jude Bellingham','Rodrygo Goes','Thibaut Courtois','Fede Valverde','Aurélien Tchouaméni','Éder Militão','Eduardo Camavinga','Toni Kroos','Luka Modrić','Franco Mastantuono','Robert Lewandowski','Lamine Yamal','Antoine Griezmann','Jan Oblak','João Félix','Raphinha','Ronald Araújo','Frenkie de Jong','Pedri','Gavi','Álvaro Morata','Koke','Iñaki Williams','Erling Haaland','Kevin De Bruyne','Rodri','Phil Foden','Julián Álvarez','Bernardo Silva','Rúben Dias',
      'Jack Grealish','Mohamed Salah','Virgil van Dijk','Alisson Becker','Trent Alexander-Arnold','Luis Díaz','Bukayo Saka','Martin Ødegaard','Declan Rice','William Saliba','Gabriel Martinelli','Cole Palmer','Enzo Fernández','Moisés Caicedo','Bruno Fernandes','Marcus Rashford','Harry Kane','Jamal Musiala','Joshua Kimmich','Manuel Neuer','Thomas Müller','Matthijs de Ligt','Jadon Sancho','Julian Brandt','Florian Wirtz','Exequiel Palacios','Lautaro Martínez',
      'Dibu Martínez','Nicolò Barella','Federico Dimarco','Federico Chiesa','Adrien Rabiot','Rafael Leão','Theo Hernández','Khvicha Kvaratskhelia','Victor Osimhen','Kylian Mbappé','Ousmane Dembélé','Marquinhos','Achraf Hakimi','Roberto Firmino','Marcelo','Gianluigi Donnarumma','Vitinha','Cristiano Ronaldo','Neymar Jr.','Karim Benzema','Sadio Mané',"N'Golo Kanté",'Kalidou Koulibaly','Lionel Messi','Luis Suárez','Sergio Busquets','Jordi Alba','Lorenzo Insigne','Mauro Icardi','Romelu Lukaku',
      'Alejandro Garnacho',"Pierre-Emerick Aubameyang","Alexis Sánchez","Arturo Vidal"
    ],

    "⭐ Leyendas": [
      "Diego Maradona","Pelé","Johan Cruyff","Roberto Baggio","David Beckham",
      "Franz Beckenbauer","Alfredo Di Stéfano","Gerd Müller","Michel Platini",
      "Zinedine Zidane","Ronaldo Nazário","Thierry Henry","Ronaldinho","Paolo Maldini",
      "Eric Cantona","Gianluigi Buffon","Giorgio Chiellini","Andrés Iniesta",
      "Xavi Hernández","Sergio Ramos","Andrea Pirlo","Francesco Totti",
      "Kaká","Samuel Eto'o","Didier Drogba","Frank Lampard","Steven Gerrard",
      "Philipp Lahm","Arjen Robben","Wesley Sneijder","Wayne Rooney",
      "Bastian Schweinsteiger","Iker Casillas","Carles Puyol","Fabio Cannavaro",
      "Alessandro Nesta","Roberto Carlos","Cafú","Javier Zanetti","Gerard Piqué",
      "Marcelo","Oliver Kahn","Edwin van der Sar","Peter Schmeichel","Juan Sebastián Verón",
      "Alessandro Del Piero","Pep Guardiola","Sergio Agüero","Gareth Bale","Eden Hazard","Paulo Dybala",
      "Radamel Falcao","James Rodríguez","Zlatan Ibrahimović","Petr Čech","Hugo Lloris","Keylor Navas",
      "Dani Alves","Thiago Silva","Pepe","David Villa","Fernando Torres","Xabi Alonso","Cesc Fàbregas","David Silva",
      "Patrick Vieira","David Trezeguet","Franck Ribéry","Luís Figo","Lev Yashin","Eusébio","Bobby Charlton","Michael Owen",
      "Rio Ferdinand","Ashley Cole","Lothar Matthäus","Miroslav Klose","Michael Ballack","Marco van Basten","Ruud Gullit",
      "Romário","Rivaldo","Sócrates","Gabriel Batistuta","Hernán Crespo","Juan Román Riquelme","Carlos Tevez","Ariel Ortega",
      "Fernando Redondo","Daniel Passarella","Mario Kempes","Óscar Ruggeri","Enzo Francescoli","Diego Forlán",
      "Carlos Valderrama","René Higuita","José Luis Chilavert","Yaya Touré"
    ],

    "🇦🇷 Liga Argentina (actuales)": [
      "Leandro Paredes","Edinson Cavani","Kevin Zenón","Alan Velasco","Miguel Merentiel","Luis Advíncula","Agustín Marchesín","Sergio Romero","Frank Fabra","Ander Herrera","Cristian Lema",
      "Gonzalo Montiel","Lucas Martínez Quarta","Germán Pezzella","Marcos Acuña","Paulo Díaz","Sebastián Driussi","Facundo Colidio","Juan Fernando Quintero","Gonzalo Martínez","Jeremías Ledesma","Ignacio Fernández","Miguel Borja","Enzo Pérez","Franco Armani",
      "Gabriel Arias","Matías Zaracho","Gastón Martirena","Adrián Maravilla Martínez","Agustín Almendra","Marcos Rojo",
      "Kevin Lomónaco","Felipe Loyola","Leonardo Godoy",
      "Cristian Medina","Fernando Muslera","Lucas Alario","Guido Carrillo","Santiago Ascacíbar","Edwuin Cetré","Facundo Farías","Ramiro Funes Mori","González Pírez","José Sosa",
      "Iker Muniain","Ángel Di María","Ignacio Malcorra","Jorge Broun","Federico Girotti"
    ],

    // 🏟️ Equipos (lista única como querías)
    "🏟️ Equipos": [
      "Boca Juniors","River Plate","Independiente","Racing Club","Estudiantes de La Plata","San Lorenzo",
      "Vélez Sarsfield","Rosario Central","Newell's Old Boys","Gimnasia y Esgrima La Plata","Talleres de Córdoba","Argentinos Juniors",
      "Lanús","Huracán","Defensa y Justicia","Godoy Cruz","Barracas","Platense",
      "Real Madrid","FC Barcelona","Atlético de Madrid","Sevilla FC","Valencia CF","Villarreal CF","Real Sociedad","Athletic Club","Real Betis","Girona FC",
      "Manchester City","Arsenal FC","Liverpool FC","Manchester United","Chelsea FC","Tottenham Hotspur","Newcastle United","Aston Villa FC","West Ham United","Everton FC","Leicester City","Brighton",
      "Bayern Múnich","Borussia Dortmund","Bayer Leverkusen","RB Leipzig",
      "Inter","AC Milan","Juventus","AS Roma","SSC Napoli","Lazio",
      "PSG","Olympique de Marsella","Olympique de Lyon","AS Monaco","LOSC Lille","Stade Rennais FC","OGC Nice","RC Lens","FC Nantes",
      "SL Benfica","FC Porto","Sporting CP","Ajax","Inter Miami CF",
      "Flamengo","Palmeiras","Corinthians","São Paulo FC","Santos FC","Grêmio","Internacional","Fluminense","Atlético Mineiro","Botafogo","Athletico Paranaense","Fortaleza",
      "Nacional","Peñarol","Colo-Colo","Universidad de Chile","Universidad Católica","LDU Quito","Barcelona SC","Independiente del Valle",
      "Atlético Nacional","Millonarios FC","América de Cali","Junior FC","Olimpia","Cerro Porteño","Libertad","Alianza Lima","Universitario"
    ],
  };

  // Aliases de compatibilidad
  FUTBOL["⭐ Leyendas (retirados)"]       = FUTBOL["⭐ Leyendas"];
  FUTBOL["🏟️ Equipos (Argentina)"]       = FUTBOL["🏟️ Equipos"];
  FUTBOL["🏟️ Equipos (Internacionales)"] = FUTBOL["🏟️ Equipos"];

  // 👥 Jugadores (todos) = actuales + liga arg + leyendas (sin duplicados)
  const ALL_PLAYERS = [
    ...FUTBOL["🌍 Jugadores actuales (mundo)"],
    ...FUTBOL["🇦🇷 Liga Argentina (actuales)"],
    ...FUTBOL["⭐ Leyendas"],
  ];
  const ALL_PLAYERS_UNIQUE = Array.from(new Set(ALL_PLAYERS));
  FUTBOL["👥 Jugadores (todos)"] = ALL_PLAYERS_UNIQUE;
  FUTBOL["Jugadores (todos)"]    = FUTBOL["👥 Jugadores (todos)"];
  FUTBOL["Todos los jugadores"]   = FUTBOL["👥 Jugadores (todos)"];

  // ===== 4) Normalizador robusto de subtema
  const FUT_KEYS = Object.keys(FUTBOL);
  const pickKey = (pred) => FUT_KEYS.find(k => pred(k.toLowerCase()));

  const normalizeSubtopic = (s = '') => {
    const t = String(s).toLowerCase().trim();

    // 👥 Jugadores (todos) → prioridad
    if (t.includes('jugad') && (t.includes('todos') || t.includes('todo'))) {
      return pickKey(k => k.includes('jugadores') && k.includes('todos')) || "👥 Jugadores (todos)";
    }

    // ⭐ Leyendas
    if (t.includes('leyend')) {
      return pickKey(k => k.includes('leyend')) || "⭐ Leyendas";
    }

    // 🌍 Jugadores actuales
    if (t.includes('jugad') && t.includes('actual')) {
      return pickKey(k => k.includes('jugadores') && k.includes('actual')) || FUT_KEYS[0];
    }

    // 🇦🇷 Liga Argentina
    if (t.includes('liga') && t.includes('arg')) {
      return pickKey(k => k.includes('liga') && k.includes('arg')) || FUT_KEYS[0];
    }

    // 🏟️ Equipos (lista única)
    if (t.includes('equip')) {
      return pickKey(k => k.includes('equip')) || "🏟️ Equipos";
    }

    // Si vino exacta
    if (FUTBOL[s]) return s;

    // Fallback dentro de Fútbol
    return "⭐ Leyendas";
  };

  // ===== 5) Elegir pool
  let pool = [];
  let resolvedSubKey = null;
  if (sel.category === 'Fútbol') {
    resolvedSubKey = normalizeSubtopic(sel.subtopic);
    log('resolved subKey:', resolvedSubKey);
    pool = FUTBOL[resolvedSubKey] || FUTBOL["⭐ Leyendas"];
  } else {
    pool = BASE[sel.category] || BASE.animales;
  }

  if (!Array.isArray(pool) || pool.length === 0) {
    log('WARN: pool vacío, usando animales como último recurso');
    pool = BASE.animales;
  }

  // ===== 6) RNG robusto + evitar repetir impostor
  const rand = (max) => crypto.randomInt(0, max); // [0, max)

  const word = pool[rand(pool.length)];
  const n = players.length;

  let impostorIndex = rand(n);
  if (lastImpostorId && n > 1) {
    let tries = 5;
    while (tries-- > 0 && players[impostorIndex].id === lastImpostorId) {
      impostorIndex = rand(n);
    }
    if (players[impostorIndex].id === lastImpostorId) {
      // fuerza cambio si no hubo suerte aleatoria
      impostorIndex = (impostorIndex + 1) % n;
    }
  }
  const impostorId = players[impostorIndex].id;

  log('picked word:', word, '| subKey:', resolvedSubKey, '| impostorIndex:', impostorIndex);
  return { players, word, impostorId, impostorIndex, currentPlayerIndex: 0, subtopic: resolvedSubKey };
}

module.exports = { setupGame };
