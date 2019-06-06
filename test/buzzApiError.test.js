const expect = require("chai").expect;
const BuzzApiError = require("../buzzApiError");

describe("BuzzApiErrors", () => {
  it("Sets default values", () => {
    const err = new BuzzApiError();
    expect(err.name).to.equal("BuzzAPIError");
    expect(err.message).to.equal("BuzzApi error");
  });
});
