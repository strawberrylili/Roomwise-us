import { Suspense } from "react";
import { Studio, StudioSkeleton } from "@/components/studio/studio";

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<StudioSkeleton />}>
      <StudioForParams params={params} />
    </Suspense>
  );
}

async function StudioForParams({ params }: { params: PageProps<"/projects/[id]">["params"] }) {
  const { id } = await params;
  return <Studio id={id} />;
}
