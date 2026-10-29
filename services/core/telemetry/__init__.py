import shutil
from pathlib import Path
import psutil
from ..persistence import now


class Telemetry:
    def __init__(self, directory: Path):
        self.directory = directory
        self.primed = False
        self.nvml = None
        self.gpu = None
        try:
            import pynvml
            pynvml.nvmlInit()
            self.nvml = pynvml
            self.gpu = pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception:
            pass

    def sample(self):
        cpu = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory()
        disk = shutil.disk_usage(self.directory)
        value = dict(timestamp=now(), source='psutil / sistema operacional',
                     cpu_percent=cpu if self.primed else None,
                     cpu_cores=psutil.cpu_count(logical=False) or 0,
                     cpu_threads=psutil.cpu_count() or 0,
                     ram_percent=ram.percent, ram_total=ram.total, ram_used=ram.total-ram.available,
                     disk_percent=round(disk.used / disk.total * 100, 1), disk_free=disk.free,
                     gpu_percent=None, gpu_name=None, gpu_temperature=None, cpu_temperature=None)
        self.primed = True
        if self.nvml and self.gpu:
            try:
                value.update(gpu_name=self.nvml.nvmlDeviceGetName(self.gpu),
                             gpu_percent=self.nvml.nvmlDeviceGetUtilizationRates(self.gpu).gpu,
                             gpu_temperature=self.nvml.nvmlDeviceGetTemperature(self.gpu, 0))
                value['source'] += ' + NVIDIA NVML'
            except Exception:
                pass
        try:
            sensors = psutil.sensors_temperatures()
            for name in ('coretemp', 'k10temp', 'cpu_thermal'):
                if sensors.get(name):
                    value['cpu_temperature'] = sensors[name][0].current
                    break
        except (AttributeError, OSError):
            pass
        return value

    def close(self):
        if self.nvml:
            try:
                self.nvml.nvmlShutdown()
            except Exception:
                pass
