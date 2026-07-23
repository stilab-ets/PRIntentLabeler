type ListPage<T> = { data: T[] };
type ListMethod<T, TParameters> = (
  parameters: TParameters,
) => Promise<ListPage<T>>;

type OptionalPaginate = {
  paginate?: (method: unknown, parameters: unknown) => Promise<unknown[]>;
};

/**
 * Utilise la pagination Octokit en production. Le repli sur une page garde les
 * petits mocks de tests et les clients Octokit minimaux compatibles.
 */
export async function listAllPages<T, TParameters>(
  octokit: unknown,
  method: ListMethod<T, TParameters>,
  parameters: TParameters,
): Promise<T[]> {
  const client = octokit as OptionalPaginate;
  if (typeof client.paginate === "function") {
    return (await client.paginate(method, parameters)) as T[];
  }

  const response = await method(parameters);
  return response.data;
}
