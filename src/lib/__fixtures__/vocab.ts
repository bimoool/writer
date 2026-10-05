// Разные по основе значимые слова для тестов разнообразия: не стоп-слова, не короче 4 букв, основы все разные.
// Слова придуманные: нужно лишь, чтобы токенизатор и стеммер видели в них слова с разными основами.
const C = ['б', 'в', 'г', 'д', 'з', 'к', 'м', 'п', 'р', 'т'];
const V = ['а', 'о', 'у', 'и'];
export const VOCAB: string[] = [];
for (let i = 0; i < C.length * V.length * C.length * V.length; i++) {
  const a = i % C.length;
  const b = Math.floor(i / C.length) % V.length;
  const c = Math.floor(i / (C.length * V.length)) % C.length;
  const d = Math.floor(i / (C.length * V.length * C.length)) % V.length;
  VOCAB.push(`${C[a]}${V[b]}${C[c]}${V[d]}ж`);
}
