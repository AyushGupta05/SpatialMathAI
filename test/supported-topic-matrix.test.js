import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalyticPlan } from "../server/services/plan/analytic.js";
import { buildElectricFieldPlan } from "../server/services/plan/electricField.js";
import { heuristicPlan, heuristicSourceSummary } from "../server/services/plan/heuristics.js";

test("supported builder prompts map to stable lesson families", async (t) => {
  const builderCases = [
    {
      name: "cylinder volume",
      prompt: "Find the volume of a cylinder with radius 3 and height 7.",
      assertPlan(plan) {
        assert.equal(plan.problem.questionType, "volume");
        assert.equal(plan.objectSuggestions[0].object.shape, "cylinder");
        assert.equal(plan.representationMode, "3d");
      },
    },
    {
      name: "cube surface area companion",
      prompt: "Find the surface area of a cube with side length 4.",
      assertPlan(plan) {
        assert.equal(plan.problem.questionType, "surface_area");
        assert.equal(plan.representationMode, "split_2d");
        assert.equal(plan.objectSuggestions[0].object.shape, "cube");
      },
    },
    {
      name: "cone net",
      prompt: "Draw the net of a cone with radius 4 and height 6.",
      assertPlan(plan) {
        assert.equal(plan.representationMode, "2d");
        assert.equal(plan.objectSuggestions[0].object.shape, "cone");
      },
    },
    {
      name: "shape comparison",
      prompt: "Compare a cube and a sphere and decide which parameter matters more.",
      assertPlan(plan) {
        assert.equal(plan.problem.questionType, "comparison");
        assert.ok(plan.buildSteps.length >= 2);
      },
    },
  ];

  for (const builderCase of builderCases) {
    await t.test(builderCase.name, () => {
      const sourceSummary = heuristicSourceSummary({ questionText: builderCase.prompt, imageAsset: null });
      const plan = heuristicPlan(builderCase.prompt, "guided", sourceSummary);
      builderCase.assertPlan(plan);
    });
  }
});

test("supported analytic prompts map to the expected 3d subtypes", async (t) => {
  const analyticCases = [
    {
      name: "line-plane intersection",
      prompt: "A line passes through the point P(1, -2, 3) with direction d = (2, 1, -1). The plane Pi has equation 2x - y + z = 7. Find the coordinates of the point where the line intersects the plane.",
      expectedSubtype: "line_plane_intersection",
    },
    {
      name: "line-plane angle",
      prompt: "A line has direction vector (3, -2, 1) and a plane has equation 2x + y - 2z = 6. Find the angle between the line and the plane.",
      expectedSubtype: "line_plane_angle",
    },
    {
      name: "skew lines distance",
      prompt: "Two lines in space are given by r1 = (1,2,0) + t(2,-1,3), r2 = (4,-1,2) + s(1,2,-1). Find the shortest distance between the two skew lines.",
      expectedSubtype: "skew_lines_distance",
    },
  ];

  for (const analyticCase of analyticCases) {
    await t.test(analyticCase.name, () => {
      const plan = buildAnalyticPlan(analyticCase.prompt);
      assert.equal(plan.analyticContext.subtype, analyticCase.expectedSubtype);
      assert.equal(plan.representationMode, "3d");
    });
  }
});

test("supported electric-field prompts map to focused physics playgrounds", async (t) => {
  const electricCases = [
    {
      name: "single charge",
      prompt: "Show the electric field around a positive charge.",
      expectedId: "electric-field-single_charge",
    },
    {
      name: "dipole",
      prompt: "Build a dipole with opposite charges.",
      expectedId: "electric-field-dipole",
    },
    {
      name: "gaussian flux",
      prompt: "Use Gauss's law to explain electric flux through a Gaussian surface.",
      expectedId: "electric-field-flux",
    },
  ];

  for (const physicsCase of electricCases) {
    await t.test(physicsCase.name, () => {
      const plan = buildElectricFieldPlan(physicsCase.prompt);
      assert.ok(plan);
      assert.equal(plan.problem.id, physicsCase.expectedId);
      assert.ok(plan.objectSuggestions.some((suggestion) => suggestion.object.metadata.physics));
    });
  }
});
