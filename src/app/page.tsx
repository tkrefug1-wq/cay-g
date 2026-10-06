import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import Workspace from '@/components/workspace';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <Workspace user={user} />;
}
