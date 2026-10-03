import { ru } from '../i18n/ru';

export function Home() {
  return (
    <main className="mx-auto w-full max-w-[64ch] px-4 pt-12">
      <h1 className="mb-4 text-ui text-text-dim">{ru.home.prompt}</h1>
      <p className="reading-column text-text">{ru.home.sample}</p>
    </main>
  );
}
