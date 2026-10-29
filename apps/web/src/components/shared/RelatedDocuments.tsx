import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface RelatedDoc {
  id: string;
  label: string;
  type: string;
  url: string;
}

interface RelatedDocumentsProps {
  documents: RelatedDoc[];
}

export function RelatedDocuments({ documents }: RelatedDocumentsProps) {
  const intl = useIntl();

  if (documents.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        {intl.formatMessage({ id: "relatedDocuments.title" })}
      </h4>
      <div className="flex flex-wrap gap-2">
        {documents.map((doc) => (
          <Link
            key={doc.id}
            to={doc.url}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            <FileText className="size-3.5 text-muted-foreground" />
            <span>{doc.label}</span>
            <Badge variant="outline" className="text-[10px]">
              {doc.type}
            </Badge>
            <ArrowRight className="size-3 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
