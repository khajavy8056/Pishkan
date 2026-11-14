export interface RequestDocumentRequirement {
  key: string;
  title: string;
  required: boolean;
  documentType?: string;
}

/** Resolve the persisted service snapshot to the same keys used by the API. */
export function requestDocumentRequirements(request: any): RequestDocumentRequirement[] {
  const service = request?.snapshot?.service ?? {};
  const documents = Array.isArray(service.documents) ? service.documents : [];
  const fields = Array.isArray(service.form) ? service.form.filter((field: any) => field?.type === 'file') : [];
  return [
    ...documents.map((document: any, index: number) => ({
      key: typeof document?.key === 'string' && document.key ? document.key : `document_${index + 1}`,
      title: String(document?.title ?? `مدرک ${index + 1}`),
      required: Boolean(document?.required),
      documentType: typeof document?.documentType === 'string' ? document.documentType : undefined,
    })),
    ...fields.map((field: any) => ({
      key: `field:${String(field.key)}`,
      title: String(field.label ?? field.key),
      required: Boolean(field.required),
    })),
  ];
}

export function latestRequestDocument(request: any, requirement: RequestDocumentRequirement) {
  const matching = (request?.documents ?? []).filter((document: any) => document.kind === 'customer' && (
    document.requirementKey === requirement.key || (!document.requirementKey && document.title === requirement.title)
  ));
  return matching[matching.length - 1] ?? null;
}

export function availableRequestDocumentRequirements(request: any) {
  return requestDocumentRequirements(request).filter((requirement) => {
    const latest = latestRequestDocument(request, requirement);
    return !latest || latest.status === 'rejected';
  });
}

export function defaultRequestDocumentRequirementKey(request: any) {
  const available = availableRequestDocumentRequirements(request);
  const rejected = available.find((requirement) => latestRequestDocument(request, requirement)?.status === 'rejected');
  return (rejected ?? available[0])?.key ?? '';
}
