import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
// @ts-ignore
import ImageJpeg from "../../media/test.jpeg?jsx";
// @ts-ignore
import ImageSvg from "../../media/qwik-logo.svg?jsx";
// @ts-ignore
import ImageJpegResized from "../../media/test.jpeg?jsx&w=100&h=100&format=avif";

export default component$(() => {
  return (
    <div>
      <h1 onClick$={() => console.warn("hola")}>Welcome to Qwik City</h1>
      <p>The meta-framework for Qwik.</p>
      <ImageJpeg id="image-jpeg" />
      <ImageSvg id="image-svg" />
      <ImageJpegResized id="image-avif" />
    </div>
  );
});

export const head: DocumentHead = {
  title: "Welcome to Qwik City",
};
