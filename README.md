# VariablurJS

<img src="octocat.png" alt="Example" width="200"/>

Variable blur and filter utility for web overlays, inspired by iOS and original [Variablur](https://github.com/daprice/Variablur) project. Supports variable blur and other CSS filters.

## Usage

Just include the script directly in your HTML:

```html
<script src="/path/to/variableblur/index.js"></script>
```

After loading, `VariablurJS` is available globally. It works automatically on elements using the correct CSS variables—no need to call any methods manually.

See `examples/demo.html` for a usage example in the browser.

## API (Advanced)

If you want to control it manually, you can use:

- `VariablurJS.attach(element)` – Attach variable blur to an element
- `VariablurJS.detach(element)` – Remove variable blur from an element
- `VariablurJS.update(element)` – Manually update blur on an element
- `VariablurJS.hasAnyVariableCSS(element)` – Check if element uses variable blur CSS variables
- Math utilities: `calcBlurPerLayer`, `exponentialBlurLayers`, etc.

## CSS Variables

- `--variable-backdrop-filter`: CSS filter string (e.g. `blur(20px)`)
- `--variable-backdrop-direction`: `top`, `bottom`, `left`, `right`
- `--variable-backdrop-offset`: e.g. `40px` or `20%`
- `--variable-backdrop-layers`: number of layers
- `--variable-backdrop-color`: overlay color

## Contributing

Contributions are most welcome! Feel free to submit issues and pull requests to help improve **VariablurJS**.

1. Fork the repository.
2. Create a new branch for your feature or bugfix.
3. Submit a pull request when your code is ready.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

For any inquiries or feedback, feel free to reach out!

<a href="https://www.buymeacoffee.com/berkaytumal" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>