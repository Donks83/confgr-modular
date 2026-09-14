// sharp, removed.
//
// `@gltf-transform/functions` DECLARES sharp as a dependency and never imports
// it: both mentions in its source are inside doc comments showing how you would
// pass it to `textureCompress`, which this project does not call. Nothing in
// the AR pipeline touches an image at all - it merges, prunes, dedups and
// unpartitions geometry.
//
// But sharp is a NATIVE module, so the deployed function tried to load a
// platform binary and failed twice: first with the Windows build uploaded to a
// Linux runtime, then - after installing @img/sharp-linux-x64 - with
// "libvips-cpp.so.8.18.6: cannot open shared object file". Two 502s for a
// library that is never called.
//
// So it is aliased to this at bundle time. If some future code path really does
// want image processing, it will say so loudly here rather than silently
// shipping a broken function.

const refuse = () => {
  throw new Error(
    'sharp was removed from this build deliberately: nothing in the AR pipeline '
    + 'processes images, and its native binaries broke the deployed function. '
    + 'If you need it, drop the alias in tools/deploy-netlify.ps1 and make sure '
    + 'the Linux binaries are installed for the runtime.',
  );
};

const sharp = new Proxy(refuse, { get: refuse, apply: refuse, construct: refuse });

export default sharp;
