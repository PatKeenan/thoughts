import EditorScreen from "@/components/editor/EditorScreen";

export default async function WritePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorScreen id={id} />;
}
