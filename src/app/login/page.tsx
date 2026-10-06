import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import Login from '@/components/login';
export default async function Page() { if (await currentUser()) redirect('/'); return <Login />; }
