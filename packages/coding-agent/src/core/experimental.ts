export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.BAILU_EXPERIMENTAL === "1";
}
