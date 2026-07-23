import { describe, expect, it, vi } from "vitest";
import { listAllPages } from "../src/github/pagination.js";

describe("listAllPages", () => {
  it("utilise Octokit.paginate lorsque disponible", async () => {
    const method = vi.fn();
    const paginate = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const result = await listAllPages({ paginate }, method, { per_page: 100 });

    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(paginate).toHaveBeenCalledWith(method, { per_page: 100 });
    expect(method).not.toHaveBeenCalled();
  });

  it("accepte un client minimal sans paginate pour les tests", async () => {
    const method = vi.fn().mockResolvedValue({ data: [{ id: 1 }] });

    const result = await listAllPages({}, method, { per_page: 100 });

    expect(result).toEqual([{ id: 1 }]);
    expect(method).toHaveBeenCalledWith({ per_page: 100 });
  });
});
