import type { Prisma } from "@prisma/client";
import { BRANDS } from "@/lib/lidl/catalog";

// Multilingual search: Lidl titles arrive in the shop's language (or via the translated
// titleEn), so every known user word expands to the equivalent words shoppers see in titles.
const SYNONYMS: Record<string, string[]> = {
  screwdriver: ["akkuschrauber", "schrauber", "parafusadeira", "atornillador", "visseuse", "avvitatore", "parafuso"],
  drill: ["bohrer", "bohrmaschine", "perceuse", "taladro", "trapano", "furadeira", "perforadora"],
  kettle: ["wasserkocher", "bouilloire", "hervidor", "bollitore", "jarro elétrico"],
  headphones: ["kopfhörer", "headset", "casque", "auriculares", "cuffie", "earbuds"],
  vacuum: ["staubsauger", "aspirateur", "aspirador", "aspirapolvere", "beutelloser"],
  saw: ["säge", "sierra", "scie", "sega", "sabre", "ketten"],
  grinder: ["schleifer", "winkelschleifer", "meuleuse", "amoladora", "levigatrice", "rebarbadora"],
  light: ["lampe", "leuchte", "lampada", "lámpara", "luminária", "strahler", "scheinwerfer", "spot"],
  torch: ["taschenlampe", "linterna", "lanterna", "flashlight", "leuchte"],
  bike: ["fahrrad", "fiets", "vélo", "velo", "bicicleta", "bici", "fahrradträger"],
  tent: ["zelt", "tente", "carpa", "tenda", "tienda de campaña"],
  oven: ["backofen", "ofen", "four", "horno", "forno"],
  coffee: ["kaffeemaschine", "kaffee", "cafetière", "cafetera", "macchina da caffè", "machine à café"],
  toaster: ["toaster", "grille-pain", "tostadora", "tostapane"],
  fan: ["ventilator", "ventilateur", "ventilador", "ventilatore", "luftkühler"],
  heater: ["heizlüfter", "heizung", "thermo", "chauffage", "calefactor", "termoventilatore", "aquecedor"],
  airfryer: ["air fryer", "friteuse", "freidora", "friggitrice", "fritadeira"],
  blender: ["standmixer", "mixer", "batidora", "blender"],
  scale: ["waage", "balance", "báscula", "bilancia", "balança", "personenwaage"],
  battery: ["batterie", "akku", "pile", "pila", "bateria"],
  charger: ["ladegerät", "lader", "chargeur", "cargador", "caricabatterie", "carregador"],
  garden: ["garten", "jardin", "jardín", "giardino", "jardim"],
  pump: ["pumpe", "pompe", "bomba", "pompa"],
  pressure: ["druckreiniger", "nettoyeur haute", "hidrolimpiadora", "idropulitrice", "hidrolavadora"],
  grill: ["barbecue", "barbacoa", "barbecues", "griglia"],
  barbecue: ["grill", "grillen", "bbq", "churrasco"],
  table: ["tisch", "table", "mesa", "tavolo"],
  chair: ["stuhl", "chaise", "silla", "sedia", "cadeira"],
  bed: ["bett", "lit", "cama", "letto"],
  pillow: ["kissen", "oreiller", "almohada", "cuscino", "almofada"],
  towel: ["handtuch", "serviette", "toalla", "asciugamano", "toalha"],
  blanket: ["decke", "couverture", "manta", "coperta", "cobertor"],
  curtain: ["vorhang", "rideau", "cortina", "tenda", "cortinado"],
  shirt: ["hemd", "chemise", "camisa", "camicia"],
  shoe: ["schuhe", "chaussures", "zapatos", "scarpe", "sapatos", "sneaker"],
  sock: ["socken", "chaussettes", "calcetines", "calze", "meias"],
  jacket: ["jacke", "veste", "chaqueta", "giacca", "casaco"],
  pants: ["hose", "hosen", "pantalon", "pantalón", "pantalone", "calças"],
  watch: ["uhr", "montre", "reloj", "orologio", "relógio", "smartwatch"],
  speaker: ["lautsprecher", "enceinte", "altavoz", "altoparlante", "coluna", "soundbox"],
  iron: ["bügeleisen", "fer à repasser", "plancha", "ferro da stiro", "ferro de engomar"],
  sewing: ["nähmaschine", "machine à coudre", "máquina de coser", "macchina per cucire", "máquina de costura"],
  camera: ["kamera", "überwachungskamera", "caméra", "cámara", "telecamera", "câmara"],
  router: ["wlan", "repeater", "wifi", "wi-fi"],
  mower: ["rasenmäher", "tondeuse", "cortacésped", "tagliaerba", "cortarelva"],
  chainsaw: ["kettensäge", "tronçonneuse", "motosierra", "motosega", "motosserra"],
  trimmer: ["rasentrimmer", "débroussailleuse", "desbrozadora", "decespugliatore", "roçadeira"],
  hose: ["schlauch", "tuyau", "manguera", "tubo", "mangueira"],
  mattress: ["matratze", "matelas", "colchón", "materasso", "colchão"],
  duvet: ["decke", "couette", "edredón", "piumino", "edredão"],
  cosmetics: ["kosmetik", "cosmétique", "cosméticos", "cosmetici", "maquiagem"],
  shampoo: ["shampooing", "champú", "shampô"],
  toothbrush: ["zahnbürste", "brosse à dents", "cepillo de dientes", "spazzolino", "escova"],
  toothpaste: ["zahncreme", "dentifrice", "pasta de dientes", "dentifricio", "pasta de dentes"],
};

type Tokenize = (q: string) => string[];

export function variantsFor(token: string): string[] {
  const key = token.toLowerCase();
  const out = new Set<string>([key]);
  const syn = SYNONYMS[key];
  if (syn) for (const s of syn) out.add(s.toLowerCase());
  // brand names: "livergy" -> livery, sub-brand family names
  for (const b of BRANDS) {
    if (b.queries.some((x) => x.toLowerCase() === key) || b.slug === key || b.family === key) {
      out.add(b.slug);
      for (const q of b.queries) out.add(q.toLowerCase());
    }
  }
  // crude plural/singular forgiveness
  if (key.length > 4 && key.endsWith("s")) out.add(key.slice(0, -1));
  if (key.length > 3) out.add(`${key}s`);
  return [...out].slice(0, 12);
}

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;+&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 8);
}

const containsAny = (field: "title" | "titleEn" | "brandName" | "category", variants: string[]) => ({
  OR: variants.map((v) => ({ [field]: { contains: v } })),
});

export function buildWhereForSearch(q: string | undefined): Prisma.ProductWhereInput | undefined {
  if (!q) return undefined;
  const tokens = tokenize(q);
  if (!tokens.length) return undefined;
  return {
    AND: tokens.map((t) => ({
      OR: [containsAny("title", variantsFor(t)), containsAny("titleEn", variantsFor(t)), containsAny("brandName", variantsFor(t))],
    })),
  };
}
