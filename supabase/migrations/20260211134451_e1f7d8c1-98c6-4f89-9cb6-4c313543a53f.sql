-- Create storage bucket for template assets (logos extracted from pptx templates)
INSERT INTO storage.buckets (id, name, public) VALUES ('template-assets', 'template-assets', true);

-- Allow anyone to view template assets
CREATE POLICY "Template assets are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'template-assets');

-- Allow anonymous uploads (no auth required for this tool)
CREATE POLICY "Anyone can upload template assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'template-assets');