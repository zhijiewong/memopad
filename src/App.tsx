import { TitleBar } from './components/TitleBar';

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Memopad — Phase 1 skeleton
      </main>
    </div>
  );
}
