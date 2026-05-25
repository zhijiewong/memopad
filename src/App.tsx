import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';

export default function App() {
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
