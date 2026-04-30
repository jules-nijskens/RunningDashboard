import UploadForm from '@/components/UploadForm';
import Link from 'next/link';

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10 text-center">
          <Link 
            href="/"
            className="text-blue-600 hover:text-blue-800 font-medium mb-4 inline-block transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
            Upload Run
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            Import your Garmin activity data.
          </p>
        </header>

        <UploadForm />
      </div>
    </main>
  );
}
