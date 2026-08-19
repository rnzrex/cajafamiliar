const rules: Array<{ category: string; words: string[] }> = [
  { category: "Comida / cenas", words: ["cena", "pollo", "pizza", "hamburguesa", "comida"] },
  { category: "Mercado", words: ["mercado", "verdura", "fruta", "abarrotes"] },
  { category: "Luz", words: ["luz"] },
  { category: "Agua", words: ["agua"] },
  { category: "Teléfono", words: ["telefono", "celular", "claro", "movistar", "entel"] },
  { category: "Internet", words: ["internet", "wifi"] },
  { category: "Préstamos", words: ["banco", "prestamo", "cuota", "tarjeta"] },
  { category: "Transporte", words: ["taxi", "gasolina", "pasaje", "transporte"] },
  { category: "Salud", words: ["doctor", "medicina", "farmacia"] },
  { category: "Ocio", words: ["cine", "salida", "ocio"] },
  { category: "Cigarrillos", words: ["cigarro", "cigarrillo", "tabaco"] },
  { category: "Compras personales", words: ["ropa", "zapato", "compra"] },
  { category: "Negocio", words: ["negocio", "restaurante", "taffy"] },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function detectCategory(description: string): string {
  const cleanText = normalize(description);
  return rules.find((rule) => rule.words.some((word) => cleanText.includes(word)))?.category ?? "Negocio";
}
